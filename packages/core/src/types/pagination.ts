// Pagination models matching the Spring Data page contract (snake_case wire
// shape) and the query parameters that drive it.

/** A page of results as the large-collection list endpoints return it. */
export interface Page<T> {
  content: T[];
  total_elements: number;
  total_pages: number;
  /** Zero-based page index. */
  number: number;
  size: number;
  first: boolean;
  last: boolean;
}

/**
 * Query parameters for a paginated request. `sort` is a Spring sort expression
 * over a camelCase entity property, e.g. "createdAt,desc".
 */
export interface PageParams {
  page?: number;
  size?: number;
  sort?: string;
}
