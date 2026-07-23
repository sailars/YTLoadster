import type { ToolInventory, ToolStatus as ToolStatusType } from "../lib/types";
import { useI18n } from "../lib/i18n";

type Props = {
  tools: ToolInventory | null;
};

export function ToolStatus({ tools }: Props) {
  const { t } = useI18n();
  const items = tools ? [tools.ytdlp, tools.ffmpeg, tools.ffprobe, tools.jsRuntime] : [];

  return (
    <section className="tool-strip" aria-label={t("tools.status")}>
      {items.length === 0 ? (
        <span className="tool-pill pending">{t("tools.checking")}</span>
      ) : (
        items.map((tool) => <ToolPill key={tool.name} tool={tool} readyLabel={t("tools.ready")} missingLabel={t("tools.missing")} />)
      )}
    </section>
  );
}

function ToolPill({ tool, readyLabel, missingLabel }: { tool: ToolStatusType; readyLabel: string; missingLabel: string }) {
  const found = tool.state === "Found";

  return (
    <div className={found ? "tool-pill ready" : "tool-pill missing"}>
      <span className="status-dot" aria-hidden="true" />
      <span>{tool.name}</span>
      <strong>{found ? readyLabel : missingLabel}</strong>
    </div>
  );
}
