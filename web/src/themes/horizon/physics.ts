/**
 * Units and the few formulas everything shares. Lengths are in Schwarzschild
 * radii (Rs = 1): the event horizon is r = 1, the photon sphere r = 1.5, the
 * innermost stable circular orbit r = 3. The disk is stored in polar form
 * between DISK_R0 and DISK_R1 on a log radius, so the inner edge, where
 * lensing magnifies most, gets the most texels.
 */
export const R_HORIZON = 1;
export const R_PHOTON = 1.5;
export const R_ISCO = 3;
export const DISK_R0 = 2.2;
export const DISK_R1 = 18;
export const LOG_SPAN = Math.log(DISK_R1 / DISK_R0);

/** Inner-disk orbital speed on screen: one turn at the ISCO every ~14 s. */
export const OMEGA_ISCO = (Math.PI * 2) / 14;

/** Visual angular velocity (rad/s) at radius r: Keplerian, scaled to OMEGA_ISCO at r = 3. */
export function omega(r: number): number {
  return OMEGA_ISCO * Math.pow(R_ISCO / Math.max(r, 1.2), 1.5);
}

/** Disk-plane polar texture coordinates for (x, z). */
export function diskUV(x: number, z: number): [number, number] {
  const r = Math.hypot(x, z);
  let u = Math.atan2(z, x) / (Math.PI * 2);
  if (u < 0) u += 1;
  return [u, Math.log(r / DISK_R0) / LOG_SPAN];
}

/** Radius at polar texture row v. */
export function radiusAt(v: number): number {
  return DISK_R0 * Math.exp(v * LOG_SPAN);
}

/** Gravitational redshift factor seen from far away (0 at the horizon, 1 at infinity). */
export function gravShift(r: number): number {
  return Math.sqrt(Math.max(0, 1 - R_HORIZON / r));
}

export const GLSL_PHYS = /* glsl */`
  const float PI = 3.14159265359;
  const float TAU = 6.28318530718;
  const float DISK_R0 = ${DISK_R0.toFixed(4)};
  const float DISK_R1 = ${DISK_R1.toFixed(4)};
  const float LOG_SPAN = ${LOG_SPAN.toFixed(6)};
  const float OMEGA_ISCO = ${OMEGA_ISCO.toFixed(6)};
  float omegaAt(float r) { return OMEGA_ISCO * pow(3.0 / max(r, 1.2), 1.5); }
  float radiusAt(float v) { return DISK_R0 * exp(v * LOG_SPAN); }
`;
