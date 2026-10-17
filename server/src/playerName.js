export function normalizePlayerName(value) {
  if (typeof value !== "string") {
    throw new Error("Escribe un nombre para unirte a la sala.");
  }

  const name = value.trim();
  if (!name) throw new Error("Escribe un nombre para unirte a la sala.");
  if (name.length > 20) throw new Error("El nombre debe tener 20 caracteres o menos.");
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("El nombre contiene caracteres no permitidos.");
  }
  return name;
}
