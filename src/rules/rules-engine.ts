import type { CallIntent, EscalationReason, Sentiment, StructuredFacts } from "../domain/call-types.js";

export type RuleCondition =
  | { field: "intent"; operator: "equals"; value: CallIntent }
  | { field: "sentiment"; operator: "equals"; value: Sentiment }
  | { field: "retryCount"; operator: "greater_than_or_equal"; value: number }
  | { field: `facts.${string}`; operator: "exists" | "missing"; value?: never };

export type RuleAction =
  | { type: "escalate"; reason: EscalationReason }
  | { type: "set_fact"; key: string; value: string | number | boolean | null }
  | { type: "allow_tool"; toolName: string }
  | { type: "deny_tool"; toolName: string; reason: string }
  | { type: "add_warning"; message: string };

export type BusinessRule = {
  ruleId: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  actions: RuleAction[];
};

export type RuleContext = {
  intent: CallIntent | null;
  sentiment: Sentiment;
  retryCount: number;
  facts: StructuredFacts;
};

export type RuleEvaluation = {
  ruleId: string;
  matched: boolean;
  actions: RuleAction[];
};

export function evaluateRules(rules: BusinessRule[], context: RuleContext): RuleEvaluation[] {
  return rules
    .filter((rule) => rule.enabled)
    .sort((a, b) => b.priority - a.priority)
    .map((rule) => {
      const matched = rule.conditions.every((condition) => evaluateCondition(condition, context));
      return {
        ruleId: rule.ruleId,
        matched,
        actions: matched ? rule.actions : [],
      };
    });
}

function evaluateCondition(condition: RuleCondition, context: RuleContext): boolean {
  if (condition.field === "intent") return context.intent === condition.value;
  if (condition.field === "sentiment") return context.sentiment === condition.value;
  if (condition.field === "retryCount") return context.retryCount >= condition.value;

  const factKey = condition.field.slice("facts.".length);
  const exists = Object.prototype.hasOwnProperty.call(context.facts, factKey) && context.facts[factKey] != null;
  if (condition.operator === "exists") return exists;
  if (condition.operator === "missing") return !exists;
  return false;
}

