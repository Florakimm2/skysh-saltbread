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