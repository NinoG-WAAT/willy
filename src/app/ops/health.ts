export interface Health {
  status: "ok";
}

/** Status only: never expose data, versions, configuration or dependency details (A05). */
export function getHealth(): Health {
  return { status: "ok" };
}
