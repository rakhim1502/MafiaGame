import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";


const firebaseConfig = {
  apiKey: "AIzaSyD5yrJBJKWlmWJ9MDfgk4ZNcbMacGjv6pc",
  authDomain: "mafiagame-e348d.firebaseapp.com",
  projectId: "mafiagame-e348d",
  storageBucket: "mafiagame-e348d.firebasestorage.app",
  messagingSenderId: "915924828018",
  appId: "1:915924828018:web:190bfb4241a96dc197e7eb"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
