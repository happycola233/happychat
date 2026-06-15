import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Copy } from "lucide-react";

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <pre className="code-shell">{children}</pre>,
          code: ({ className, children }) => {
            const code = String(children ?? "");
            const block = className?.startsWith("language-");
            if (!block) return <code className={className}>{children}</code>;
            return (
              <span className="code-wrap">
                <button
                  className="copy-code"
                  type="button"
                  onClick={() => navigator.clipboard.writeText(code)}
                >
                  <Copy size={14} />
                  复制
                </button>
                <code className={className}>{children}</code>
              </span>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
