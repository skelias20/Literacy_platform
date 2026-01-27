import jwt, { JwtPayload } from "jsonwebtoken";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in environment variables`);
  return v;
}

const JWT_SECRET = requireEnv("JWT_SECRET");

export type AdminJwtPayload = {
  adminId: string;
  email: string;
};

export function signAdminJwt(payload: AdminJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyAdminJwt(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }

  const obj = decoded as JwtPayload;

  const adminId = obj.adminId;
  const email = obj.email;

  if (typeof adminId !== "string" || typeof email !== "string") {
    throw new Error("Invalid token payload shape");
  }

  return { adminId, email };
}
export type StudentJwtPayload = {
  childId: string;
  username: string;
};

export function signStudentJwt(payload: StudentJwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyStudentJwt(token: string): StudentJwtPayload {
  const decoded = jwt.verify(token, JWT_SECRET);

  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token payload");
  }

  const obj = decoded as JwtPayload;

  const childId = obj.childId;
  const username = obj.username;

  if (typeof childId !== "string" || typeof username !== "string") {
    throw new Error("Invalid token payload shape");
  }

  return { childId, username };
}
