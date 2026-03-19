export function parseQueryParams(queryString: string) {
  const params = new URLSearchParams(queryString);
  const result: { [key: string]: string } = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

export default parseQueryParams;