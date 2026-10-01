export const KINDS = ["screen", "book", "comic", "game"] as const;
export type Kind = (typeof KINDS)[number];

export const STATUSES = ["done", "doing", "wish"] as const;
export type Status = (typeof STATUSES)[number];

const KIND_INFO: Record<Kind, { label: string; verb: string; creator: string }> = {
  screen: { label: "影视", verb: "看", creator: "导演" },
  book: { label: "书", verb: "读", creator: "作者" },
  comic: { label: "漫画", verb: "读", creator: "作者" },
  game: { label: "游戏", verb: "玩", creator: "开发" },
};

export function isKind(value: unknown): value is Kind {
  return KINDS.includes(value as Kind);
}

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}

export function kindLabel(kind: Kind) {
  return KIND_INFO[kind].label;
}

export function creatorLabel(kind: Kind) {
  return KIND_INFO[kind].creator;
}

/** 看过 / 在读 / 想玩… */
export function statusLabel(status: Status, kind?: Kind) {
  const verb = kind ? KIND_INFO[kind].verb : "看";
  return { done: `${verb}过`, doing: `在${verb}`, wish: `想${verb}` }[status];
}

/** Status label when no single kind applies. */
export function genericStatusLabel(status: Status) {
  return { done: "已完成", doing: "进行中", wish: "想要" }[status];
}
