import * as jose from "jose";

export interface JWTPayload {
  userId: string;
  email?: string;
  exp?: number;
  iat?: number;
}

// Validate JWT_SECRET is set in production
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}
// Use a development secret only in non-production environments
const SECRET = JWT_SECRET ?? "development-secret-DO-NOT-USE-IN-PRODUCTION";
const DEFAULT_EXPIRATION = "7d";

/**
 * Create a JWT token for authentication.
 */
export async function createJWT(
  payload: Omit<JWTPayload, "exp" | "iat">,
  expiresIn: string = DEFAULT_EXPIRATION
): Promise<string> {
  const secretKey = new TextEncoder().encode(SECRET);

  const jwt = await new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secretKey);

  return jwt;
}

/**
 * Verify and decode a JWT token.
 */
export async function verifyJWT(token: string): Promise<JWTPayload | null> {
  try {
    const secretKey = new TextEncoder().encode(SECRET);
    const { payload } = await jose.jwtVerify(token, secretKey);

    return {
      userId: payload.userId as string,
      email: payload.email as string | undefined,
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}
