export interface JwtPayload {
  sub: string;
  email: string;
  /** Role the user is currently acting as (for auditing & permission checks). */
  activeRoleId: string;
}
