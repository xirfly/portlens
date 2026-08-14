import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleStop,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface PortProcess {
  pid: number;
  name: string;
  protocols: string;
  ports: string[];
  executable: string;
  commandLine: string;
  startedAt: number;
  isSystem: boolean;
}

type Scope = "development" | "user" | "all";

const developmentPattern = /(^|[\\/\s])(node|npm|npx|pnpm|yarn|bun|deno|python|python3|py|uvicorn|flask|django|java|gradle|mvn|cargo|rustc|go|dotnet|php|docker-proxy)(\.exe)?([\s"']|$)/i;

function isDevelopmentProcess(row: PortProcess) {
  return developmentPattern.test(`${row.name} ${row.executable} ${row.commandLine}`);
}

function formatStartedAt(timestamp: number) {
  if (!timestamp) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(timestamp * 1000));
}

function processReason(row: PortProcess) {
  if (row.isSystem) return "Windows 系统进程";
  if (isDevelopmentProcess(row)) return "开发运行时";
  return "用户进程";
}

export default function App() {
  const [rows, setRows] = useState<PortProcess[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("development");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedPid, setExpandedPid] = useState<number | null>(null);
  const [selectedPids, setSelectedPids] = useState<Set<number>>(() => new Set());
  const [pendingKills, setPendingKills] = useState<PortProcess[]>([]);
  const [killing, setKilling] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const result = await invoke<PortProcess[]>("list_port_processes");
      setRows(result);
      const selectablePids = new Set(result.filter((row) => !row.isSystem).map((row) => row.pid));
      setSelectedPids((current) => new Set([...current].filter((pid) => selectablePids.has(pid))));
      setError("");
    } catch (reason) {
      setError(String(reason));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refresh(true), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const inScope =
        scope === "all" ||
        (scope === "user" && !row.isSystem) ||
        (scope === "development" && !row.isSystem && isDevelopmentProcess(row));
      if (!inScope) return false;
      if (!normalizedQuery) return true;
      return `${row.name} ${row.pid} ${row.protocols} ${row.ports.join(" ")} ${row.executable} ${row.commandLine}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, rows, scope]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selectedPids.has(row.pid) && !row.isSystem),
    [rows, selectedPids],
  );
  const visibleSelectableRows = visibleRows.filter((row) => !row.isSystem);
  const allVisibleSelected = visibleSelectableRows.length > 0 && visibleSelectableRows.every((row) => selectedPids.has(row.pid));
  const someVisibleSelected = visibleSelectableRows.some((row) => selectedPids.has(row.pid)) && !allVisibleSelected;
  const hiddenSystemCount = rows.filter((row) => row.isSystem).length;
  const portCount = visibleRows.reduce((total, row) => total + row.ports.length, 0);

  function toggleSelected(pid: number) {
    setSelectedPids((current) => {
      const next = new Set(current);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedPids((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleSelectableRows.forEach((row) => next.delete(row.pid));
      else visibleSelectableRows.forEach((row) => next.add(row.pid));
      return next;
    });
  }

  async function confirmKill() {
    if (pendingKills.length === 0) return;
    setKilling(true);
    const targets = [...pendingKills];
    const results = await Promise.allSettled(
      targets.map((row) => invoke("kill_process_tree", { pid: row.pid })),
    );
    const succeeded = targets.filter((_, index) => results[index].status === "fulfilled");
    const failures = results
      .map((result, index) => result.status === "rejected" ? `${targets[index].name}: ${String(result.reason)}` : "")
      .filter(Boolean);

    setSelectedPids((current) => {
      const next = new Set(current);
      succeeded.forEach((row) => next.delete(row.pid));
      return next;
    });
    setPendingKills([]);
    if (succeeded.length > 0) setNotice(`已结束 ${succeeded.length} 个进程，释放其监听端口`);
    if (failures.length > 0) setError(`${failures.length} 个进程结束失败：${failures.join("；")}`);
    await refresh(true);
    setKilling(false);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><Server size={18} /></div>
          <div>
            <h1>PortLens</h1>
            <p>本地监听端口与进程</p>
          </div>
        </div>
        <div className="status-chip">
          <ShieldCheck size={15} />
          系统进程保护已开启
        </div>
      </header>

      <main>
        <section className="toolbar" aria-label="端口筛选工具">
          <div className="search-field">
            <Search size={16} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索应用、PID、端口"
              aria-label="搜索端口进程"
            />
            {query && (
              <button className="icon-button compact" onClick={() => setQuery("")} title="清空搜索" aria-label="清空搜索">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="segmented" aria-label="进程范围">
            <button className={scope === "development" ? "active" : ""} onClick={() => setScope("development")}>开发</button>
            <button className={scope === "user" ? "active" : ""} onClick={() => setScope("user")}>用户</button>
            <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>全部</button>
          </div>

          <label className="toggle-label">
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span className="toggle" aria-hidden="true" />
            自动刷新
          </label>

          {selectedRows.length > 0 && (
            <button className="batch-button" onClick={() => setPendingKills(selectedRows)}>
              <CircleStop size={15} />
              结束所选 ({selectedRows.length})
            </button>
          )}
          <button className="secondary-button refresh-button" onClick={() => void refresh()} disabled={loading} title="刷新端口列表">
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            <span>刷新</span>
          </button>
        </section>

        {error && (
          <div className="message error-message" role="alert">
            <AlertTriangle size={17} />
            <span>{error}</span>
            <button className="icon-button" onClick={() => setError("")} aria-label="关闭错误"><X size={15} /></button>
          </div>
        )}

        <section className="table-panel" aria-label="监听端口列表">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="select-column">
                    <input
                      type="checkbox"
                      className="row-checkbox"
                      checked={allVisibleSelected}
                      ref={(element) => { if (element) element.indeterminate = someVisibleSelected; }}
                      onChange={toggleAllVisible}
                      disabled={visibleSelectableRows.length === 0}
                      aria-label="选择当前列表中的所有可结束进程"
                      title="全选当前列表"
                    />
                  </th>
                  <th className="expand-column" aria-label="详情" />
                  <th>应用</th>
                  <th>PID</th>
                  <th>协议</th>
                  <th>监听端口</th>
                  <th className="action-column">操作</th>
                  <th>启动时间</th>
                  <th>识别</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const expanded = expandedPid === row.pid;
                  return (
                    <FragmentRow
                      key={row.pid}
                      row={row}
                      expanded={expanded}
                      selected={selectedPids.has(row.pid)}
                      onToggle={() => setExpandedPid(expanded ? null : row.pid)}
                      onSelect={() => toggleSelected(row.pid)}
                      onKill={() => setPendingKills([row])}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && visibleRows.length === 0 && (
            <div className="empty-state">
              <Server size={26} />
              <strong>当前范围没有监听端口</strong>
              <span>切换进程范围或清除搜索条件</span>
            </div>
          )}
          {loading && rows.length === 0 && (
            <div className="empty-state"><RefreshCw size={24} className="spin" /><strong>正在扫描本地端口</strong></div>
          )}
        </section>

        <footer className="table-footer">
          <span>显示 <strong>{visibleRows.length}</strong> 个进程 · <strong>{portCount}</strong> 个端口</span>
          <span>{selectedRows.length > 0 ? `已选择 ${selectedRows.length} 个` : scope !== "all" ? `已隐藏 ${hiddenSystemCount} 个系统进程` : ""}</span>
        </footer>
      </main>

      {pendingKills.length > 0 && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !killing && setPendingKills([])}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="kill-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="danger-icon"><CircleStop size={22} /></div>
            <div className="dialog-content">
              <h2 id="kill-title">结束{pendingKills.length > 1 ? `${pendingKills.length} 个进程树` : "进程树"}？</h2>
              {pendingKills.length === 1 ? (
                <p>将强制结束 <strong>{pendingKills[0].name}</strong>（PID {pendingKills[0].pid}）及其子进程。</p>
              ) : (
                <div className="process-summary" aria-label="待结束进程">
                  {pendingKills.slice(0, 5).map((row) => <span key={row.pid}>{row.name} <small>PID {row.pid}</small></span>)}
                  {pendingKills.length > 5 && <span>另有 {pendingKills.length - 5} 个进程</span>}
                </div>
              )}
              <div className="port-summary">将释放 {new Set(pendingKills.flatMap((row) => row.ports)).size} 个监听端口</div>
              <p className="warning-text">未保存的数据会丢失，关联子进程也会被强制结束。</p>
            </div>
            <div className="dialog-actions">
              <button className="secondary-button" onClick={() => setPendingKills([])} disabled={killing}>取消</button>
              <button className="danger-button" onClick={() => void confirmKill()} disabled={killing}>
                {killing ? <RefreshCw size={15} className="spin" /> : <CircleStop size={15} />}
                {killing ? "正在结束" : "确认结束"}
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status" aria-live="polite"><CheckCircle2 size={16} />{notice}</div>}
    </div>
  );
}

function FragmentRow({ row, expanded, selected, onToggle, onSelect, onKill }: {
  row: PortProcess;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onKill: () => void;
}) {
  return (
    <>
      <tr className={`${expanded ? "expanded-row " : ""}${selected ? "selected-row" : ""}`}>
        <td className="select-column">
          <input
            type="checkbox"
            className="row-checkbox"
            checked={selected}
            onChange={onSelect}
            disabled={row.isSystem}
            aria-label={row.isSystem ? `${row.name} 是受保护的系统进程` : `选择 ${row.name}，PID ${row.pid}`}
          />
        </td>
        <td className="expand-column">
          <button className="icon-button" onClick={onToggle} aria-label={expanded ? "收起进程详情" : "展开进程详情"}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </td>
        <td><div className="process-name" title={row.name}>{row.name}</div></td>
        <td className="numeric">{row.pid}</td>
        <td><span className="protocol-label">{row.protocols}</span></td>
        <td><div className="ports" title={row.ports.join(", ")}>{row.ports.map((port) => <code key={port}>{port}</code>)}</div></td>
        <td className="action-column">
          <button className="kill-icon" onClick={onKill} disabled={row.isSystem} title={row.isSystem ? "系统进程受保护" : "结束进程树"} aria-label={`结束 ${row.name} 进程树`}>
            <CircleStop size={16} />
          </button>
        </td>
        <td className="muted numeric">{formatStartedAt(row.startedAt)}</td>
        <td><span className={`reason ${row.isSystem ? "system" : isDevelopmentProcess(row) ? "development" : "user"}`}>{processReason(row)}</span></td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td /><td />
          <td colSpan={7}>
            <dl>
              <div><dt>启动时间</dt><dd>{formatStartedAt(row.startedAt)}</dd></div>
              <div><dt>识别</dt><dd>{processReason(row)}</dd></div>
              <div><dt>可执行文件</dt><dd>{row.executable || "无法读取"}</dd></div>
              <div><dt>命令行</dt><dd>{row.commandLine || "无法读取"}</dd></div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
