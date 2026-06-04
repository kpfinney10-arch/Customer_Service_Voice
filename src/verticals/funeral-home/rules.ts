import type { BusinessRule } from "../../rules/rules-engine.js";

export const funeralHomeRules: BusinessRule[] = [
  {
    ruleId: "funeral_urgent_first_call_escalate",
    name: "Escalate urgent first-call intake",
    enabled: true,
    priority: 100,
    conditions: [{ field: "intent", operator: "equals", value: "first_call_intake" }],
    actions: [{ type: "escalate", reason: "urgent_death_report" }],
  },
  {
    ruleId: "caller_distress_escalate",
    name: "Escalate distressed callers",
    enabled: true,
    priority: 95,
    conditions: [{ field: "sentiment", operator: "equals", value: "angry" }],
    actions: [{ type: "escalate", reason: "caller_distress" }],
  },
  {
    ruleId: "retry_budget_escalate",
    name: "Escalate after repeated misunderstanding",
    enabled: true,
    priority: 80,
    conditions: [{ field: "retryCount", operator: "greater_than_or_equal", value: 2 }],
    actions: [{ type: "escalate", reason: "retry_budget_exhausted" }],
  },
];

