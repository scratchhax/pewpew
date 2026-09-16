import { Vector3, type PerspectiveCamera } from 'three';
import { STREETS, type Board } from './board';

/**
 * The flight: a god's-eye view forward down the board, looking steeply down,
 * sliding slowly between streets with barely any bank, climbing over tall parts
 * (capacitor towers, heat sinks). `steerX` pins the heading (a dive lining up on a chip).
 */
export class Flight {
  z = 0;
  x = 0;
  alt = 12;
  vx = 0;
  speed = 26;
  /** Height above the low point: high over the board, lower inside a chip. */
  lift = 62;
  private targetX = 0;
  private nextTurn = 2;
  private roll = 0;
  private t = 0;
  private look = new Vector3();

  update(dt: number, board: Board, camera: PerspectiveCamera, o: { speed: number; steerX?: number | null; low?: number; wanderX?: number; wanderY?: number }): void {
    this.t += dt;
    this.speed += (o.speed - this.speed) * Math.min(1, dt * 0.8);
    this.z -= this.speed * dt;
    this.nextTurn -= dt;
    if (o.steerX !== undefined && o.steerX !== null) this.targetX = o.steerX;
    else if (this.nextTurn <= 0) {
      this.nextTurn = 6 + Math.random() * 7;
      const s = STREETS[Math.floor(Math.random() * STREETS.length)];
      this.targetX = Math.max(-130, Math.min(130, Math.random() < 0.7 ? s + (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 240));
    }
    // slow, deliberate slides across the board
    const want = Math.max(-10, Math.min(10, (this.targetX - this.x) * 0.3));
    this.vx += (want - this.vx) * Math.min(1, dt * 1.1);
    this.x += this.vx * dt;
    // clearance over the parts coming up
    let h = 0;
    for (let dz = 6; dz <= 46; dz += 4) for (let dx = -10; dx <= 10; dx += 5) h = Math.max(h, board.heightAt(this.x + dx, this.z - dz));
    const base = (o.low ?? 9) + this.lift + Math.sin(this.t * 0.11) * 6 + Math.sin(this.t * 0.037 + 1) * 4;
    const altTarget = Math.max(base, h + 7);
    this.alt += (altTarget - this.alt) * Math.min(1, dt * (altTarget > this.alt ? 2.6 : 0.7));
    // barely any bank: a god's-eye view, not a plane
    this.roll += (-this.vx * 0.014 * 0.2 - this.roll) * Math.min(1, dt * 3);
    const breathe = Math.sin(this.t * 0.23) * 1.5;
    camera.position.set(this.x + (o.wanderX ?? 0) * 0.01, this.alt + breathe + (o.wanderY ?? 0) * 0.005, this.z);
    // looking steeply down: the board is laid out below like a map, with a slow drift in heading
    this.look.set(this.x + this.vx * 0.35 + Math.sin(this.t * 0.05) * 6, 0, this.z - (this.alt * 0.25 + 6));
    camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    camera.lookAt(this.look);
    camera.fov = 58 + Math.min(12, (this.speed - 26) * 0.22);
    camera.updateProjectionMatrix();
  }
}
