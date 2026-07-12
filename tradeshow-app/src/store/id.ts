// Small collision-resistant id generator (no native crypto dependency needed).
let counter = 0;

export function newId(): string {
  counter = (counter + 1) % 100000;
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${Date.now().toString(36)}-${counter.toString(36)}-${rand}`;
}
