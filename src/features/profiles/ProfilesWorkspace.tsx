import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Filter,
  GripVertical,
  Inbox,
  List,
  Lock,
  Monitor,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import type { LocaleText } from "../../i18n/localeText";
import type { LanguageSetting, Profile, TunnelStatus } from "../../types/domain";
import {
  displayProfileName,
  displayTunnelDetail,
  formatConnectionDuration,
  formatLastConnection,
  tunnelStatusLabel,
} from "../../lib/display";
import { firstProfileValidationError } from "../../lib/profile";

interface ProfilesWorkspaceProps {
  text: LocaleText;
  profiles: Profile[];
  visibleProfiles: Profile[];
  selectedIds: string[];
  selectedProfileId: string;
  selectedConnectionId: string | null;
  visibleSelectedProfiles: Profile[];
  runningCount: number;
  tunnelStatuses: Record<string, TunnelStatus>;
  draftProfile: Profile;
  language: LanguageSetting;
  searchQuery: string;
  isBusy: boolean;
  hasVisibleSelection: boolean;
  hasSingleVisibleSelection: boolean;
  invalidSelectedProfileNames: string[];
  isConnectionsView: boolean;
  canReorder: boolean;
  reorderProfiles: (sourceId: string, targetId: string) => void;
  moveProfile: (profileId: string, direction: -1 | 1) => void;
  createNewProfile: () => void;
  startProfiles: (targetProfiles?: Profile[]) => void;
  stopProfiles: (targetProfiles?: Profile[]) => void;
  editSelectedProfile: () => void;
  copyProfile: () => void;
  deleteSelectedProfiles: () => void;
  setSearchQuery: (value: string) => void;
  showAllProfiles: () => void;
  showActiveConnections: () => void;
  toggleSelectAll: () => void;
  toggleSelected: (id: string) => void;
  selectProfile: (profile: Profile) => void;
  selectConnection: (profile: Profile) => void;
  statusClass: (profile: Profile) => string;
}

export function ProfilesWorkspace({
  text,
  profiles,
  visibleProfiles,
  selectedIds,
  selectedProfileId,
  selectedConnectionId,
  visibleSelectedProfiles,
  runningCount,
  tunnelStatuses,
  draftProfile,
  language,
  searchQuery,
  isBusy,
  hasVisibleSelection,
  hasSingleVisibleSelection,
  invalidSelectedProfileNames,
  isConnectionsView,
  canReorder,
  reorderProfiles,
  moveProfile,
  createNewProfile,
  startProfiles,
  stopProfiles,
  editSelectedProfile,
  copyProfile,
  deleteSelectedProfiles,
  setSearchQuery,
  showAllProfiles,
  showActiveConnections,
  toggleSelectAll,
  toggleSelected,
  selectProfile,
  selectConnection,
  statusClass,
}: ProfilesWorkspaceProps) {
  const filterRef = useRef<HTMLDivElement>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // Native drag events are "continuous" in React 19, so a setState in onDragStart
  // may not commit before the next dragover fires — the stale draggingId would then
  // skip preventDefault and the browser shows a "no-drop" cursor. A ref stays in sync.
  const draggingIdRef = useRef<string | null>(null);
  const hasRunningConnections = runningCount > 0;
  const draggingIndex = draggingId
    ? visibleProfiles.findIndex((item) => item.id === draggingId)
    : -1;

  useEffect(() => {
    if (!isFilterOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !filterRef.current?.contains(event.target)) {
        setIsFilterOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterOpen]);

  useEffect(() => {
    if (!isConnectionsView || !hasRunningConnections) {
      return;
    }

    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isConnectionsView, hasRunningConnections]);

  const isEmptyConnectionsView = isConnectionsView && runningCount === 0;
  const { activeProxyCount, activeSshServerCount } = useMemo(() => {
    const runningProfiles = profiles.filter((profile) => tunnelStatuses[profile.id]?.status === "running");
    return {
      activeProxyCount: new Set(
        runningProfiles.map((profile) => `${profile.localProxyHost}:${profile.localProxyPort}`),
      ).size,
      activeSshServerCount: new Set(
        runningProfiles.map((profile) => `${profile.sshHost.trim().toLowerCase()}:${profile.sshPort}`),
      ).size,
    };
  }, [profiles, tunnelStatuses]);
  const emptyTitle = isEmptyConnectionsView
    ? text.table.noActiveConnectionsTitle
    : profiles.length === 0
      ? text.table.emptyTitle
      : text.table.noMatchesTitle;
  const emptyHint = isEmptyConnectionsView
    ? text.table.noActiveConnectionsHint
    : profiles.length === 0
      ? text.table.emptyHint
      : text.table.noMatchesHint;
  const EmptyIcon = isEmptyConnectionsView ? Activity : Inbox;

  return (                <>
                  <div className={`action-row ${isConnectionsView ? "connections-actions" : ""}`}>
                    {isConnectionsView ? (
                      <div
                        className="connection-topology"
                        aria-label={text.table.connectionTopologyLabel(
                          activeProxyCount,
                          runningCount,
                          activeSshServerCount,
                        )}
                      >
                        <span className="topology-node">
                          <span className="topology-icon">
                            <Monitor size={17} />
                          </span>
                          <span className="topology-copy">
                            <small>{text.table.proxyEndpointMetric}</small>
                            <strong>{text.table.countMetric(activeProxyCount)}</strong>
                          </span>
                        </span>
                        <span className="topology-bridge" aria-hidden />
                        <span className="topology-node topology-node-primary">
                          <span className="topology-icon">
                            <Lock size={17} />
                          </span>
                          <span className="topology-copy">
                            <small>{text.table.activeConnectionMetric}</small>
                            <strong>{text.table.countMetric(runningCount)}</strong>
                          </span>
                        </span>
                        <span className="topology-bridge" aria-hidden />
                        <span className="topology-node">
                          <span className="topology-icon">
                            <Server size={17} />
                          </span>
                          <span className="topology-copy">
                            <small>{text.table.sshServerMetric}</small>
                            <strong>{text.table.serverMetric(activeSshServerCount)}</strong>
                          </span>
                        </span>
                      </div>
                    ) : (
                      <div className="primary-actions">
                        <button className="accent-button" type="button" onClick={createNewProfile}>
                          <Plus size={16} />
                          {text.toolbar.create}
                        </button>
                        <button
                          className="toolbar-button"
                          type="button"
                          onClick={() => startProfiles()}
                          disabled={isBusy || !hasVisibleSelection || invalidSelectedProfileNames.length > 0}
                        >
                          <Play size={16} />
                          {text.toolbar.start}
                        </button>
                        <button
                          className="toolbar-button"
                          type="button"
                          onClick={() => stopProfiles()}
                          disabled={isBusy || !hasVisibleSelection}
                        >
                          <Square size={16} />
                          {text.toolbar.stop}
                        </button>
                        <button
                          className="toolbar-button"
                          type="button"
                          onClick={editSelectedProfile}
                          disabled={!hasSingleVisibleSelection}
                        >
                          <Pencil size={16} />
                          {text.toolbar.edit}
                        </button>
                        <button
                          className="toolbar-button"
                          type="button"
                          onClick={copyProfile}
                          disabled={!hasSingleVisibleSelection}
                        >
                          <Copy size={16} />
                          {text.toolbar.copy}
                        </button>
                        <button
                          className="toolbar-button"
                          type="button"
                          onClick={deleteSelectedProfiles}
                          disabled={isBusy || !hasVisibleSelection}
                        >
                          <Trash2 size={16} />
                          {text.toolbar.delete}
                        </button>
                      </div>
                    )}

                    <div className="search-tools">
                      <label className="search-box">
                        <Search size={16} />
                        <input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.currentTarget.value)}
                          placeholder={text.toolbar.searchPlaceholder}
                        />
                      </label>
                      <div className="filter-shell" ref={filterRef}>
                        <button
                          className={`square-button ${isFilterOpen ? "active" : ""}`}
                          type="button"
                          title={text.toolbar.filter}
                          aria-expanded={isFilterOpen}
                          onClick={() => setIsFilterOpen((current) => !current)}
                        >
                          <Filter size={16} />
                        </button>
                        {isFilterOpen ? (
                          <div className="filter-popover">
                            <strong>{text.toolbar.filter}</strong>
                            <p>{text.toolbar.filterDescription(visibleProfiles.length)}</p>
                            <button
                              type="button"
                              className={!isConnectionsView ? "active" : ""}
                              onClick={() => {
                                showAllProfiles();
                                setIsFilterOpen(false);
                              }}
                            >
                              {text.toolbar.showAllProfiles}
                            </button>
                            <button
                              type="button"
                              className={isConnectionsView ? "active" : ""}
                              onClick={() => {
                                showActiveConnections();
                                setIsFilterOpen(false);
                              }}
                            >
                              {text.toolbar.showActiveConnections}
                            </button>
                            <button
                              type="button"
                              disabled={!searchQuery}
                              onClick={() => {
                                setSearchQuery("");
                                setIsFilterOpen(false);
                              }}
                            >
                              {text.toolbar.clearSearch}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
    
                  <div className={`config-table ${isConnectionsView ? "connections-table" : ""}`}>
                  <div className="table-head">
                    {!isConnectionsView ? <span className="reorder-head" aria-hidden /> : null}
                    {!isConnectionsView ? (
                      <button
                        className={`check-cell ${
                          visibleProfiles.length > 0 &&
                          visibleProfiles.every((profile) => selectedIds.includes(profile.id))
                            ? "checked"
                            : ""
                        }`}
                        type="button"
                        onClick={toggleSelectAll}
                        disabled={!visibleProfiles.length}
                        aria-label={text.table.selectAll}
                      />
                    ) : null}
                    <span>{text.table.name}</span>
                    <span>{text.table.status}</span>
                    <span>{text.table.localPort}</span>
                    <span>{text.table.server}</span>
                    <span>{text.table.remotePort}</span>
                    <span>{text.table.mode}</span>
                    <span>{isConnectionsView ? text.table.connectionDuration : text.table.lastConnection}</span>
                    <span />
                  </div>
    
                  <div className="table-body">
                    {visibleProfiles.length === 0 ? (
                      <div className="profiles-empty">
                        <EmptyIcon className="profiles-empty-icon" aria-hidden />
                        <strong>{emptyTitle}</strong>
                        <p>{emptyHint}</p>
                        {isEmptyConnectionsView ? (
                          <button
                            className="toolbar-button empty-state-action"
                            type="button"
                            onClick={showAllProfiles}
                          >
                            <List size={16} />
                            {text.table.openProfiles}
                          </button>
                        ) : profiles.length === 0 ? (
                          <button
                            className="accent-button empty-state-action"
                            type="button"
                            onClick={createNewProfile}
                          >
                            <Plus size={16} />
                            {text.toolbar.create}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {visibleProfiles.map((profile, index) => {
                      const status = tunnelStatuses[profile.id];
                      const isSelected = selectedIds.includes(profile.id);
                      const isDragging = draggingId === profile.id;
                      const isDropTarget =
                        Boolean(draggingId) && draggingId !== profile.id && dragOverId === profile.id;
                      // The dropped row lands adjacent to the target in the drag direction, so
                      // point the drop indicator the same way (below when dragging downward).
                      const dropClass = isDropTarget
                        ? draggingIndex > -1 && draggingIndex < index
                          ? "drag-over-below"
                          : "drag-over-above"
                        : "";
                      const isRunning = status?.status === "running";
                      const lastConnectedAt = status?.lastConnectedAt ?? profile.lastConnectedAt;
                      const profileDisplayName = displayProfileName(profile.name, text);
                      const isFocused = isConnectionsView
                        ? selectedConnectionId === profile.id
                        : selectedProfileId === profile.id;
                      return (
                        <div
                          className={`table-row ${isFocused ? "focused" : ""} ${
                            isDragging ? "dragging" : ""
                          } ${dropClass}`}
                          key={profile.id}
                          onClick={() =>
                            isConnectionsView ? selectConnection(profile) : selectProfile(profile)
                          }
                          onDragOver={(event) => {
                            if (!canReorder || !draggingIdRef.current) {
                              return;
                            }
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            if (dragOverId !== profile.id) {
                              setDragOverId(profile.id);
                            }
                          }}
                          onDrop={(event) => {
                            const sourceId =
                              draggingIdRef.current || event.dataTransfer.getData("text/plain");
                            if (!canReorder || !sourceId) {
                              return;
                            }
                            event.preventDefault();
                            draggingIdRef.current = null;
                            setDraggingId(null);
                            setDragOverId(null);
                            reorderProfiles(sourceId, profile.id);
                          }}
                        >
                          {!isConnectionsView ? (
                            <div className="reorder-cell">
                              <div
                                className="drag-handle"
                                role="button"
                                tabIndex={canReorder ? 0 : -1}
                                aria-disabled={!canReorder}
                                draggable={canReorder}
                                aria-label={text.table.reorderHandle}
                                title={canReorder ? text.table.reorderHandle : text.table.reorderHint}
                                onClick={(event) => event.stopPropagation()}
                                onDragStart={(event) => {
                                  if (!canReorder) {
                                    event.preventDefault();
                                    return;
                                  }
                                  draggingIdRef.current = profile.id;
                                  setDraggingId(profile.id);
                                  event.dataTransfer.effectAllowed = "move";
                                  event.dataTransfer.setData("text/plain", profile.id);
                                  const row = event.currentTarget.closest(".table-row");
                                  if (row instanceof HTMLElement) {
                                    event.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2);
                                  }
                                }}
                                onDragEnd={() => {
                                  draggingIdRef.current = null;
                                  setDraggingId(null);
                                  setDragOverId(null);
                                }}
                                onKeyDown={(event) => {
                                  if (!canReorder) {
                                    return;
                                  }
                                  if (event.key === "ArrowUp") {
                                    event.preventDefault();
                                    moveProfile(profile.id, -1);
                                  } else if (event.key === "ArrowDown") {
                                    event.preventDefault();
                                    moveProfile(profile.id, 1);
                                  }
                                }}
                              >
                                <GripVertical size={16} />
                              </div>
                              <span className="reorder-steps">
                                <button
                                  type="button"
                                  className="reorder-step"
                                  aria-label={text.table.moveUp}
                                  title={text.table.moveUp}
                                  disabled={!canReorder || index === 0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveProfile(profile.id, -1);
                                  }}
                                >
                                  <ChevronUp size={12} />
                                </button>
                                <button
                                  type="button"
                                  className="reorder-step"
                                  aria-label={text.table.moveDown}
                                  title={text.table.moveDown}
                                  disabled={!canReorder || index === visibleProfiles.length - 1}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    moveProfile(profile.id, 1);
                                  }}
                                >
                                  <ChevronDown size={12} />
                                </button>
                              </span>
                            </div>
                          ) : null}
                          {!isConnectionsView ? (
                            <button
                              className={`check-cell ${isSelected ? "checked" : ""}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleSelected(profile.id);
                              }}
                              aria-label={text.table.selectProfile(profileDisplayName)}
                            />
                          ) : null}
                          <div className="name-cell">
                            <strong>{profileDisplayName}</strong>
                            <span>
                              SSH -{" "}
                              {profile.localProxyProtocol === "http"
                                ? text.table.httpProxy
                                : text.table.socks5Proxy}
                            </span>
                          </div>
                          <div className={`status-cell ${statusClass(profile)}`}>
                            <span />
                            <strong>{tunnelStatusLabel(status?.status, text)}</strong>
                            <small>{displayTunnelDetail(status, text)}</small>
                          </div>
                          <span>{profile.localProxyPort}</span>
                          <span>
                            {profile.sshHost}
                            <small>{profile.sshPort}</small>
                          </span>
                          <span>{profile.remoteProxyPort}</span>
                          <span>{profile.localProxyProtocol.toUpperCase()}</span>
                          <span className={isConnectionsView ? "connection-duration" : undefined}>
                            {isConnectionsView ? (
                              <>
                                <Clock size={14} aria-hidden />
                                <span>{formatConnectionDuration(lastConnectedAt, nowMs)}</span>
                              </>
                            ) : lastConnectedAt
                                ? formatLastConnection(lastConnectedAt, language)
                                : isRunning
                                  ? text.table.currentSession
                                  : "-"}
                          </span>
                          <button
                            className={`row-play ${isRunning ? "stop" : ""}`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void (isRunning ? stopProfiles([profile]) : startProfiles([profile]));
                            }}
                            title={isRunning ? text.table.stopProfile : text.table.startProfile}
                            aria-label={isRunning ? text.table.stopProfile : text.table.startProfile}
                            disabled={
                              isBusy ||
                              Boolean(
                                !isRunning &&
                                  firstProfileValidationError(
                                    profile.id === draftProfile.id ? draftProfile : profile,
                                    profiles,
                                    text,
                                  ),
                              )
                            }
                          >
                            {isRunning ? <Square size={14} /> : <Play size={14} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
    
                  <div className="table-footer">
                    {text.table.totalProfiles(profiles.length)}
                    {!isConnectionsView ? (
                      <span>{text.table.selectedProfiles(visibleSelectedProfiles.length)}</span>
                    ) : null}
                    <span>{text.table.activeConnections(runningCount)}</span>
                  </div>
                  </div>
                </>
  );
}
