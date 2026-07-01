export const FIRST_CALL_TARGET_FACTS = [
  "caller_name",
  "caller_phone",
  "caller_relationship_to_decedent",
  "decedent_name",
  "death_reported",
  "place_of_death_type",
  "pickup_address",
  "pickup_contact_name",
  "pickup_contact_phone",
  "currently_with_decedent",
  "requested_funeral_home",
  "preferred_callback_number",
  "urgency",
] as const;

export const FIRST_CALL_OPTIONAL_FACTS = [
  "date_of_death",
  "time_of_death",
  "facility_name",
  "facility_contact_role",
  "dropoff_preference",
  "special_handling_notes",
  "religious_or_cultural_notes",
  "caller_emotional_state",
  "crm_existing_case_reference",
  "reasonForCall",
] as const;

export type FirstCallTargetFact = (typeof FIRST_CALL_TARGET_FACTS)[number];
export type FirstCallOptionalFact = (typeof FIRST_CALL_OPTIONAL_FACTS)[number];
export type FirstCallFact = FirstCallTargetFact | FirstCallOptionalFact;

export type PlaceOfDeathType =
  | "residence"
  | "hospital"
  | "hospice"
  | "nursing_home"
  | "medical_examiner"
  | "other"
  | "unknown";

export type FirstCallUrgency = "routine" | "urgent" | "emergency" | "unknown";

export type FirstCallFacts = {
  caller_name?: string;
  caller_phone?: string;
  caller_relationship_to_decedent?: string;
  decedent_name?: string;
  death_reported?: boolean;
  place_of_death_type?: PlaceOfDeathType;
  pickup_address?: string;
  pickup_contact_name?: string;
  pickup_contact_phone?: string;
  currently_with_decedent?: boolean;
  requested_funeral_home?: string;
  preferred_callback_number?: string;
  urgency?: FirstCallUrgency;
  date_of_death?: string;
  time_of_death?: string;
  facility_name?: string;
  facility_contact_role?: string;
  dropoff_preference?: string;
  special_handling_notes?: string;
  religious_or_cultural_notes?: string;
  caller_emotional_state?: string;
  crm_existing_case_reference?: string;
  reasonForCall?: string;
};

export function missingFirstCallTargetFacts(
  facts: Partial<FirstCallFacts>,
  targetFacts: readonly FirstCallTargetFact[] = FIRST_CALL_TARGET_FACTS,
): FirstCallTargetFact[] {
  return targetFacts.filter((fact) => facts[fact] == null || facts[fact] === "");
}

export function hasMinimumCrmIntakeFacts(facts: Partial<FirstCallFacts>): boolean {
  return Boolean(facts.urgency);
}

export function hasMinimumDispatchRequestFacts(facts: Partial<FirstCallFacts>): boolean {
  return Boolean((facts.pickup_address || facts.facility_name) && !requiresAuthorityVerificationBeforeDispatch(facts));
}

export function requiresAuthorityVerificationBeforeDispatch(facts: Partial<FirstCallFacts>): boolean {
  return facts.place_of_death_type === "residence" && !hasAuthorizedRemovalSource(facts);
}

function hasAuthorizedRemovalSource(facts: Partial<FirstCallFacts>): boolean {
  if (facts.caller_relationship_to_decedent === "facility_staff") return true;
  if (facts.facility_name && facts.place_of_death_type && facts.place_of_death_type !== "residence") return true;
  return isAuthorityRole(facts.facility_contact_role);
}

function isAuthorityRole(role: string | undefined): boolean {
  return /^(?:nurse|doctor|social_worker|chaplain|case_manager|investigator|medical_examiner|coroner|deputy_coroner|police_officer|officer|detective|deputy|sheriff)$/.test(
    role ?? "",
  );
}
