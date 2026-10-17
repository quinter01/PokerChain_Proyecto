export function isTableHost(hostAddress, playerAddress) {
  return typeof hostAddress === "string"
    && typeof playerAddress === "string"
    && hostAddress.toLowerCase() === playerAddress.toLowerCase();
}
