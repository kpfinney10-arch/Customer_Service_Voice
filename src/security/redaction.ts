const phonePattern = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/g;

export type RedactionResult = {
  value: string;
  redacted: boolean;
  categories: string[];
};

export function redactText(input: string): RedactionResult {
  const categories = new Set<string>();
  let value = input.replace(phonePattern, () => {
    categories.add("phone");
    return "[REDACTED_PHONE]";
  });
  value = value.replace(emailPattern, () => {
    categories.add("email");
    return "[REDACTED_EMAIL]";
  });
  value = value.replace(ssnPattern, () => {
    categories.add("ssn");
    return "[REDACTED_SSN]";
  });

  return {
    value,
    redacted: categories.size > 0,
    categories: [...categories],
  };
}

