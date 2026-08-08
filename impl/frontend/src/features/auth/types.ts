export type LoginResponse = {
  status: "authenticated" | "mfa_required";
  session?: unknown;
  mfa?: unknown;
};
