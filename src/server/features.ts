import { DomainError } from "@/server/errors";

/**
 * Optional features stay off until the developer turns them on for a deployment, when the owner asks.
 * Set the variable in Vercel (Production and/or Preview) and redeploy. Turning one off only hides it:
 * its data stays and comes back when it is turned on again.
 */

/** Daily sales target: the dashboard card, the Settings section and the daily report PDF. */
export function salesTargetEnabled() {
  return process.env.FEATURE_SALES_TARGET === "1";
}

export function requireSalesTarget() {
  if (!salesTargetEnabled()) throw new DomainError("FeatureOff", "The sales target isn't turned on");
}
