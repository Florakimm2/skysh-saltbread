import { adminDb } from "@/backend/infrastructure/firebase/firebase-admin";

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export async function createUserProfile(profile: UserProfile) {
  await adminDb.collection("users").doc(profile.id).set(profile);
  return profile;
}

export async function findUserProfileById(userId: string) {
  const doc = await adminDb.collection("users").doc(userId).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as UserProfile;
}

export async function updateUserProfileName(params: {
  userId: string;
  name: string;
}) {
  const now = new Date().toISOString();
  const userRef = adminDb.collection("users").doc(params.userId);

  await userRef.set(
    {
      id: params.userId,
      userId: params.userId,
      name: params.name,
      displayName: params.name,
      updatedAt: now,
    },
    { merge: true }
  );

  const saved = await userRef.get();
  return saved.data() as UserProfile;
}
