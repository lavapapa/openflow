import AjvModule from "ajv";
import type { JsonSchema } from "../types/index.js";
const Ajv = (AjvModule as any).default || AjvModule;

export interface JsonValidationSuccess {
  ok: true;
  value: unknown;
}

export interface JsonValidationFailure {
  ok: false;
  code: "SCHEMA_VALIDATION_FAILED";
  message: string;
  errors: unknown[];
}

export type JsonValidationResult = JsonValidationSuccess | JsonValidationFailure;

export function validateJson(value: unknown, schema: JsonSchema): JsonValidationResult {
  let validate;
  try {
    // 每次验证使用独立实例，避免并发 Agent 重复编译同一 `$id` 时污染共享注册表。
    const ajv = new Ajv({ allErrors: true });
    validate = ajv.compile(schema);
  } catch (err) {
    throw new Error(`Invalid JSON Schema: ${(err as Error).message}`);
  }

  const valid = validate(value);
  if (valid) {
    return {
      ok: true,
      value
    };
  } else {
    const errors = validate.errors ?? [];
    const message = errors
      .map((e: any) => `${e.instancePath || "root"} ${e.message}`)
      .join(", ");
    return {
      ok: false,
      code: "SCHEMA_VALIDATION_FAILED",
      message: `Schema validation failed: ${message}`,
      errors
    };
  }
}
