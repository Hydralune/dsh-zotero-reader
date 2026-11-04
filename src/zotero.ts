// zotero.ts — 读取本地 Zotero 库（只读）。
//
// 数据来源：<zoteroDir>/zotero.sqlite + <zoteroDir>/storage/<attachmentKey>/<file>
// Zotero 可能正在运行并持有写锁，所以一律 readOnly 打开；绝不写入用户的 Zotero 库。
//
// 用 Node 内置 node:sqlite（Node >= 22.5 实验性 / 24 稳定）。宿主没有该模块时
// 抛明确错误，由路由转成 501，而不是静默失败。

import path from 'node:path'
import { promises as fs } from 'node:fs'

export interface ZoteroCreator {
  firstName?: string
  lastName?: string
}

export interface ZoteroAttachment {
  key: string
  /** 磁盘上的绝对路径（已解析 storage: 前缀）；解析不到时为 null */
  filePath: string | null
  filename: string
  contentType: string
}

export interface ZoteroItem {
  itemID: number
  key: string
  itemType: string
  title: string
  creators: ZoteroCreator[]
  year?: string
  doi?: string
  venue?: string
  abstract?: string
  url?: string
  dateAdded?: string
  collections: string[]
  collectionIDs: number[]
  attachments: ZoteroAttachment[]
}

export interface ZoteroCollection {
  collectionID: number
  name: string
  parentID: number | null
  itemCount: number
}

export class ZoteroError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ZoteroError'
  }
}

type SqliteModule = {
  DatabaseSync: new (p: string, opts?: Record<string, unknown>) => {
    prepare: (sql: string) => {
      all: (...args: unknown[]) => unknown[]
      get: (...args: unknown[]) => unknown
    }
    close: () => void
  }
}

let sqliteMod: SqliteModule | null | undefined

async function loadSqlite(): Promise<SqliteModule> {
  if (sqliteMod === undefined) {
    try {
      sqliteMod = (await import('node:sqlite')) as unknown as SqliteModule
    } catch {
      sqliteMod = null
    }
  }
  if (!sqliteMod) {
    throw new ZoteroError('sqlite-unavailable', 501, '当前 Node 运行时没有 node:sqlite（需要 Node >= 22.5）')
  }
  return sqliteMod
}

export async function zoteroDbPath(zoteroDir: string): Promise<string> {
  const p = path.join(zoteroDir, 'zotero.sqlite')
  try {
    await fs.access(p)
  } catch {
    throw new ZoteroError('zotero-not-found', 404, `未找到 Zotero 数据库：${p}`)
  }
  return p
}

/** 解析 Zotero 附件路径：storage:foo.pdf → <dir>/storage/<attachKey>/foo.pdf */
export function resolveAttachment(zoteroDir: string, attachKey: string, rawPath: string | null): string | null {
  if (!rawPath) return null
  if (rawPath.startsWith('storage:')) {
    const filename = rawPath.slice('storage:'.length)
    return path.join(zoteroDir, 'storage', attachKey, filename)
  }
  if (rawPath.startsWith('attachments:')) {
    return path.join(zoteroDir, 'attachments', rawPath.slice('attachments:'.length))
  }
  // 绝对路径（链接附件）原样返回
  return path.isAbsolute(rawPath) ? rawPath : path.join(zoteroDir, rawPath)
}

async function openDb(zoteroDir: string) {
  const { DatabaseSync } = await loadSqlite()
  const dbPath = await zoteroDbPath(zoteroDir)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  return db
}

const FIELD_IDS_SQL = `SELECT f.fieldName, v.value FROM itemData d
  JOIN fields f ON f.fieldID = d.fieldID
  JOIN itemDataValues v ON v.valueID = d.valueID
  WHERE d.itemID = ?`

const CREATORS_SQL = `SELECT c.firstName, c.lastName FROM itemCreators ic
  JOIN creators c ON c.creatorID = ic.creatorID
  WHERE ic.itemID = ? ORDER BY ic.orderIndex`

const ATTACH_SQL = `SELECT ai.key AS attachKey, ia.path, ia.contentType
  FROM itemAttachments ia JOIN items ai ON ai.itemID = ia.itemID
  WHERE (ia.parentItemID = ? OR ia.itemID = ?)
    AND ia.itemID NOT IN (SELECT itemID FROM deletedItems)`

const COLLECTIONS_SQL = `SELECT c.collectionName, c.collectionID FROM collectionItems ci
  JOIN collections c ON c.collectionID = ci.collectionID WHERE ci.itemID = ?`

function yearOf(dateStr?: string): string | undefined {
  if (!dateStr) return undefined
  const m = dateStr.match(/(1[6-9]\d{2}|20\d{2})/)
  return m ? m[1] : undefined
}

/** 列出 Zotero 收藏夹（含每个夹子的顶层条目数） */
export async function listCollections(zoteroDir: string): Promise<ZoteroCollection[]> {
  const db = await openDb(zoteroDir)
  try {
    const rows = db
      .prepare(
        `SELECT c.collectionID, c.collectionName, c.parentCollectionID,
                (SELECT COUNT(*) FROM collectionItems ci WHERE ci.collectionID = c.collectionID) AS n
         FROM collections c ORDER BY c.collectionName`,
      )
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => ({
      collectionID: Number(r.collectionID),
      name: String(r.collectionName ?? ''),
      parentID: r.parentCollectionID == null ? null : Number(r.parentCollectionID),
      itemCount: Number(r.n ?? 0),
    }))
  } finally {
    db.close()
  }
}

/**
 * 列出 Zotero 条目。
 * collectionID 给定时只返回该收藏夹内的条目；query 对标题做子串匹配。
 */
export async function listItems(
  zoteroDir: string,
  opts: { collectionID?: number; query?: string; limit?: number } = {},
): Promise<ZoteroItem[]> {
  const db = await openDb(zoteroDir)
  try {
    const params: unknown[] = []
    let sql = `
      SELECT i.itemID, i.key, it.typeName
      FROM items i JOIN itemTypes it ON it.itemTypeID = i.itemTypeID
      WHERE i.itemID NOT IN (SELECT itemID FROM deletedItems)
        AND it.typeName NOT IN ('note','annotation')
        AND (it.typeName != 'attachment' OR EXISTS (
          SELECT 1 FROM itemAttachments ia WHERE ia.itemID = i.itemID AND ia.parentItemID IS NULL
            AND ia.contentType = 'application/pdf'
        ))`
    if (opts.collectionID != null) {
      sql += ` AND i.itemID IN (SELECT itemID FROM collectionItems WHERE collectionID = ?)`
      params.push(opts.collectionID)
    }
    sql += ` ORDER BY i.dateAdded DESC LIMIT ?`
    params.push(Math.min(opts.limit ?? 500, 2000))

    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    const out: ZoteroItem[] = []
    const fieldStmt = db.prepare(FIELD_IDS_SQL)
    const creatorStmt = db.prepare(CREATORS_SQL)
    const attachStmt = db.prepare(ATTACH_SQL)
    const collStmt = db.prepare(COLLECTIONS_SQL)

    for (const r of rows) {
      const itemID = Number(r.itemID)
      const fields: Record<string, string> = {}
      for (const f of fieldStmt.all(itemID) as Array<Record<string, unknown>>) {
        fields[String(f.fieldName)] = String(f.value ?? '')
      }
      const title = fields.title || fields.bookTitle || `(无标题 #${itemID})`
      if (opts.query && !title.toLowerCase().includes(opts.query.toLowerCase())) continue

      const creators = (creatorStmt.all(itemID) as Array<Record<string, unknown>>).map((c) => ({
        firstName: c.firstName ? String(c.firstName) : undefined,
        lastName: c.lastName ? String(c.lastName) : undefined,
      }))

      const attachments: ZoteroAttachment[] = []
      for (const a of attachStmt.all(itemID, itemID) as Array<Record<string, unknown>>) {
        const rawPath = a.path ? String(a.path) : null
        const attachKey = String(a.attachKey ?? '')
        const contentType = String(a.contentType ?? '')
        const resolved = resolveAttachment(zoteroDir, attachKey, rawPath)
        let exists = false
        if (resolved) {
          try {
            await fs.access(resolved)
            exists = true
          } catch {
            exists = false
          }
        }
        attachments.push({
          key: attachKey,
          filePath: exists ? resolved : null,
          filename: resolved ? path.basename(resolved) : (rawPath ?? '').replace(/^storage:/, ''),
          contentType,
        })
      }

      const memberships = collStmt.all(itemID) as Array<Record<string, unknown>>
      out.push({
        itemID,
        key: String(r.key ?? ''),
        itemType: String(r.typeName ?? ''),
        title,
        creators,
        year: yearOf(fields.date),
        doi: fields.DOI || undefined,
        venue: fields.publicationTitle || fields.proceedingsTitle || undefined,
        abstract: fields.abstractNote || undefined,
        url: fields.url || undefined,
        dateAdded: fields.dateAdded || undefined,
        collections: memberships.map((c) => String(c.collectionName ?? '')),
        collectionIDs: memberships.map((c) => Number(c.collectionID)),
        attachments,
      })
    }
    return out
  } finally {
    db.close()
  }
}

/** 该条目是否已有可用的 PDF 附件 */
export function primaryPdf(item: ZoteroItem): ZoteroAttachment | undefined {
  return (
    item.attachments.find((a) => a.filePath && a.contentType === 'application/pdf') ??
    item.attachments.find((a) => a.filePath && a.filename.toLowerCase().endsWith('.pdf'))
  )
}

/** The connector stores the source URL on the imported attachment. */
export async function findImportedPdf(zoteroDir: string, sourceUrl: string) {
  const db = await openDb(zoteroDir)
  try {
    const row = db.prepare(`
      SELECT i.key, a.path FROM itemAttachments a
      JOIN items i ON i.itemID = a.itemID
      JOIN itemData d ON d.itemID = i.itemID
      JOIN fields f ON f.fieldID = d.fieldID AND f.fieldName = 'url'
      JOIN itemDataValues v ON v.valueID = d.valueID
      WHERE v.value = ? AND a.contentType = 'application/pdf'
        AND i.itemID NOT IN (SELECT itemID FROM deletedItems)`
    ).get(sourceUrl) as { key: string; path: string } | undefined
    if (!row?.path.startsWith('storage:')) return null
    const pdfPath = resolveAttachment(zoteroDir, row.key, row.path)
    if (!pdfPath) return null
    await fs.access(pdfPath)
    return { attachKey: row.key, file: path.basename(pdfPath), pdfPath }
  } finally {
    db.close()
  }
}
