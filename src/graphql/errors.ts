export class ConfigurationError extends Error {
  override name = "ConfigurationError";
}

export class GraphqlRequestError extends Error {
  override name = "GraphqlRequestError";

  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
