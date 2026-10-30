// What the "discard this session" dialog asks of the operator. Pure, so it can be tested
// without a browser. A session with real check-ins must be confirmed by typing a word;
// an empty one (someone opened it by mistake) only needs a plain confirmation.

export const CANCEL_PHRASE = "CANCEL";

export type CancelPlan = {
  /** The operator has to type CANCEL before the Discard button works. */
  needsTyping: boolean;
  /** One line saying what will be lost. */
  warning: string;
};

export function cancelPlan(checkInCount: number): CancelPlan {
  if (checkInCount <= 0) {
    return {
      needsTyping: false,
      warning: "This session has no check-ins. It will be deleted and will not appear in the history.",
    };
  }
  const noun = checkInCount === 1 ? "check-in" : "check-ins";
  return {
    needsTyping: true,
    warning: `This will permanently delete ${checkInCount} ${noun}. The net will NOT be recorded in the history or published.`,
  };
}

/** True when what was typed is the confirmation word (any case, spaces around it ignored). */
export function isCancelPhrase(typed: string): boolean {
  return typed.trim().toUpperCase() === CANCEL_PHRASE;
}

/** Whether the Discard button can be pressed, given the plan and what has been typed. */
export function canDiscard(plan: CancelPlan, typed: string, busy: boolean): boolean {
  if (busy) return false;
  return plan.needsTyping ? isCancelPhrase(typed) : true;
}
