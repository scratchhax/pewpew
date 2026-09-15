import { Vector3, type PerspectiveCamera } from 'three';
import { STREETS, type Board } from './board';

/**
 * The flight: forward down the board, weaving between streets, climbing over
 * tall parts (capacitor towers, heat sinks) and dropping into the gaps, with
 * a bank on every turn. `steerX` pins the heading (a dive lining up on a chip).
 */
export class Flight {
  z = 0;
  x = 0;
  alt = 12;
  vx = 0;
  speed = 26;
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
      this.nextTurn = 3.5 + Math.random() * 5;
      const s = STREETS[Math.floor(Math.random() * STREETS.length)];
      this.targetX = Math.random() < 0.7 ? s + (Math.random() - 0.5) * 8 : (Math.random() - 0.5) * 150;
    }
    const want = Math.max(-26, Math.min(26, (this.targetX - this.x) * 0.7));
    this.vx += (want - this.vx) * Math.min(1, dt * 1.6);
    this.x += this.vx * dt;
    // clearance over the parts coming up
    let h = 0;
    for (let dz = 6; dz <= 46; dz += 4) for (let dx = -10; dx <= 10; dx += 5) h = Math.max(h, board.heightAt(this.x + dx, this.z - dz));
    const base = (o.low ?? 9) + 5 + Math.sin(this.t * 0.11) * 3.5 + Math.sin(this.t * 0.037 + 1) * 2;
    const altTarget = Math.max(base, h + 5.5);
    this.alt += (altTarget - this.alt) * Math.min(1, dt * (altTarget > this.alt ? 2.6 : 0.7));
    this.roll += (-this.vx * 0.014 - this.roll) * Math.min(1, dt * 3);
    camera.position.set(this.x + (o.wanderX ?? 0) * 0.01, this.alt + (o.wanderY ?? 0) * 0.005, this.z);
    // steep enough to read as flying over the board, with the traces rushing up from below
    this.look.set(this.x + this.vx * 0.35, 0, this.z - (this.alt * 0.85 + 9));
    camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    camera.lookAt(this.look);
    camera.fov = 62 + Math.min(14, (this.speed - 26) * 0.25);
    camera.updateProjectionMatrix();
  }
}
