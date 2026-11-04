import type { CSSProperties } from 'react'

const paths = {
  book: 'M10 5.5C8 4 5.7 3.7 3.5 4.3v11.2c2.2-.6 4.5-.3 6.5 1.2 2-1.5 4.3-1.8 6.5-1.2V4.3c-2.2-.6-4.5-.3-6.5 1.2Zm0 0v11.2',
  chevronLeft: 'm11.8 5.5-4.5 4.5 4.5 4.5',
  chevronRight: 'm8.2 5.5 4.5 4.5-4.5 4.5',
  chevronDown: 'm5.5 8.2 4.5 4.5 4.5-4.5',
  plus: 'M10 4.5v11m-5.5-5.5h11',
  minus: 'M4.5 10h11',
  search: 'M13.2 8.7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-1.3 3.2 4 4',
  translate: 'M3 5.4h8M7 3.5v1.9m2.5 0c-.5 4-2.8 6.5-6 8m.8-5.6a10 10 0 0 0 4.2 4.6m2.1 3.5 3-7 3 7m-5-2.5h4',
  sparkle: 'M8.2 3c.7 3.5 2.3 5.1 5.8 5.8-3.5.7-5.1 2.3-5.8 5.8-.7-3.5-2.3-5.1-5.8-5.8 3.5-.7 5.1-2.3 5.8-5.8Zm7.3 8.9v4.8m-2.4-2.4h4.8',
  copy: 'M6 13H5a1.7 1.7 0 0 1-1.7-1.7V5A1.7 1.7 0 0 1 5 3.3h6.3A1.7 1.7 0 0 1 13 5v1M8.8 7.3h6.3A1.7 1.7 0 0 1 16.8 9v6.1a1.7 1.7 0 0 1-1.7 1.7H8.8a1.7 1.7 0 0 1-1.7-1.7V9a1.7 1.7 0 0 1 1.7-1.7Z',
  quote: 'M8 5.2H5.4a1.2 1.2 0 0 0-1.2 1.2v3.2a1.2 1.2 0 0 0 1.2 1.2H8V8H4.2m3.6 2.8v.7c0 1.8-1.1 3-2.9 3.5m11-9.8h-2.6a1.2 1.2 0 0 0-1.2 1.2v3.2a1.2 1.2 0 0 0 1.2 1.2h2.6V8h-3.8m3.6 2.8v.7c0 1.8-1.1 3-2.9 3.5',
  highlight: 'm5.4 11.2 7-7a1.3 1.3 0 0 1 1.8 0l1.6 1.6a1.3 1.3 0 0 1 0 1.8l-7 7H5.4v-3.4Zm0 3.4-1.9 1.9h6m1.8-11.3 3.6 3.6',
  underline: 'M5.8 4v5.4a4.2 4.2 0 0 0 8.4 0V4M5 16h10',
  strike: 'M14 6.3a5.2 5.2 0 0 0-4-1.7c-2.1 0-3.6 1.1-3.6 2.5m7.3 5.8c0 1.4-1.4 2.5-3.7 2.5-1.7 0-3.1-.6-4-1.7M3.8 10h12.4',
  thumbnails: 'M4.7 3.7h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm7.6 0h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1ZM4.7 11.3h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Zm7.6 0h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z',
  text: 'M4.5 6V4.5h11V6M10 4.5v11m-2.6 0h5.2',
  textSelect: 'M6.3 3.7H5.1a1.4 1.4 0 0 0-1.4 1.4v1.2m10-2.6h1.2a1.4 1.4 0 0 1 1.4 1.4v1.2M3.7 13.7v1.2a1.4 1.4 0 0 0 1.4 1.4h1.2m10-2.6v1.2a1.4 1.4 0 0 1-1.4 1.4h-1.2M7.2 7h5.6M10 7v6m-1.4 0h2.8',
  capture: 'M7 4H5.4A1.4 1.4 0 0 0 4 5.4V7m9-3h1.6A1.4 1.4 0 0 1 16 5.4V7M4 13v1.6A1.4 1.4 0 0 0 5.4 16H7m9-3v1.6a1.4 1.4 0 0 1-1.4 1.4H13M8.2 10h3.6M10 8.2v3.6',
  close: 'm5.7 5.7 8.6 8.6m0-8.6-8.6 8.6',
  fit: 'M6.5 4H5.4A1.4 1.4 0 0 0 4 5.4V7m9.5-3h1.1A1.4 1.4 0 0 1 16 5.4V7M4 13v1.6A1.4 1.4 0 0 0 5.4 16h1.1m9.5-3v1.6a1.4 1.4 0 0 1-1.4 1.4h-1.1M7.2 8v4m5.6-4v4',
  refresh: 'M15.7 9a5.8 5.8 0 1 0 .1 2.2m0-6.2v4h-4',
  folder: 'M3.5 6.3A1.5 1.5 0 0 1 5 4.8h3l1.6 1.6H15a1.5 1.5 0 0 1 1.5 1.5v5.8a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z',
  file: 'M6 3.5h5.7l3.8 3.8V15A1.5 1.5 0 0 1 14 16.5H6A1.5 1.5 0 0 1 4.5 15V5A1.5 1.5 0 0 1 6 3.5Zm5.5 0v4h4m-8 3h5m-5 3h5',
  outline: 'M7 5.5h9m-9 4.5h9m-9 4.5h9m-12-9h.1m-.1 4.5h.1m-.1 4.5h.1',
  note: 'M5.5 3.7h9A1.8 1.8 0 0 1 16.3 5.5v7L12.5 16.3h-7a1.8 1.8 0 0 1-1.8-1.8v-9a1.8 1.8 0 0 1 1.8-1.8Zm7 12.6v-3.8h3.8m-9-4.8h5.5m-5.5 3h2.8',
  download: 'M10 3.5v8m-3-3 3 3 3-3M4.2 12v2.4a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V12',
  upload: 'M10 11.5v-8m-3 3 3-3 3 3M4.2 12v2.4a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4V12',
  scanDocument: 'M7 3.5H5a1.5 1.5 0 0 0-1.5 1.5v2m9.5-3.5h2A1.5 1.5 0 0 1 16.5 5v2m-13 6v2A1.5 1.5 0 0 0 5 16.5h2m6 0h2a1.5 1.5 0 0 0 1.5-1.5v-2M7 7.5h6m-6 2.5h6m-6 2.5h4',
  check: 'm4.5 10 3.5 3.5 7.5-7.5',
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 16, style, className }: {
  name: IconName
  size?: number
  style?: CSSProperties
  className?: string
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  )
}

export function PanelIcon({ size, active }: { size?: number; active?: boolean }) {
  return <Icon name="book" size={size} style={{ opacity: active ? 1 : 0.75 }} />
}
