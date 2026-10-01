"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

export function CodeSample({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    await navigator.clipboard.writeText(content.replace(/\n$/, ""));
    setCopied(true);
  }

  return (
    <figure className="code-sample">
      <div className="code-header">
        <span className="code-language">{language}</span>
        <button
          type="button"
          className="code-copy"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre>
        <code className={`language-${language}`}>{content}</code>
      </pre>
    </figure>
  );
}
