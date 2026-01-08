import * as jose from "jose";

export interface JWTPayload {
  userId: string;
  email?: string;
  exp?: number;
  iat?: number;
}

const JWT_SECRET = process.env.JWT_SECRET ?? "development-secret-change-in-production";
const DEFAULT_EXPIRATION = "7d";

/**
 * Create a JWT token for authentication.
 */
export async function createJWT(
  payload: Omit<JWTPayload, "exp" | "iat">,
  expiresIn: string = DEFAULT_EXPIRATION
): Promise<string> {
  const secretKey = new TextEncoder().encode(JWT_SECRET);

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
    const secretKey = new TextEncoder().encode(JWT_SECRET);
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
