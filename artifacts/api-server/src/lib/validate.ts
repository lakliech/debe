/**
 * Zod request body validation helper.
 * Usage: const parsed = validate(schema, req.body, res);
 *        if (!parsed) return; // response already sent
 */
import { z, ZodTypeAny } from "zod";

export function validate<T extends ZodTypeAny>(
  schema: T,
  body: unknown,
  res: any,
): z.infer<T> | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const errors = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    res.status(400).json({ error: "Validation failed", errors });
    return null;
  }
  return result.data;
}
