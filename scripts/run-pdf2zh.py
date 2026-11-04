"""Run the installed pdf2zh v1 CLI with bounded paragraph retries."""
import os
import sys
from functools import wraps
from urllib.parse import urlsplit

from openai import APIConnectionError, APIStatusError
from tenacity import retry_if_exception, stop_after_attempt
from pdf2zh import converter
from pdf2zh.pdf2zh import main
from pdf2zh.translator import OpenAITranslator


def transient(error):
    return isinstance(error, APIConnectionError) or (
        isinstance(error, APIStatusError)
        and (error.status_code == 429 or error.status_code >= 500)
    )


original_retry = converter.retry


def bounded_retry(*args, **kwargs):
    kwargs.update(stop=stop_after_attempt(2), retry=retry_if_exception(transient), reraise=True)
    return original_retry(*args, **kwargs)


converter.retry = bounded_retry
original_init = OpenAITranslator.__init__


@wraps(original_init)
def init(self, *args, **kwargs):
    original_init(self, *args, **kwargs)
    self.client = self.client.with_options(timeout=35, max_retries=0)
    if urlsplit(os.environ.get("OPENAI_BASE_URL", "")).hostname == "api.deepseek.com":
        self.options["extra_body"] = {"thinking": {"type": "disabled"}}


OpenAITranslator.__init__ = init
sys.exit(main())
