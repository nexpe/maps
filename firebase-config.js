// firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  query, 
  where, 
  orderBy, 
  Timestamp,
  updateDoc,
  deleteDoc,
  writeBatch,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  signOut,
  onAuthStateChanged 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// 🔥 REEMPLAZA CON TUS DATOS DE FIREBASE (de la consola)
// Import the functions you need from the SDKs you need
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDIbAigXjfC4pMsKPZRo7jAvfZXgSYplz8",
  authDomain: "ubicaciones-87fe5.firebaseapp.com",
  projectId: "ubicaciones-87fe5",
  storageBucket: "ubicaciones-87fe5.firebasestorage.app",
  messagingSenderId: "749334504476",
  appId: "1:749334504476:web:7cca089bd1493cdfd06bd9"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 🔧 MODO DESARROLLO - Detectar si estamos en localhost
const isDevelopment = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1';

if (isDevelopment) {
  console.log('🔧 MODO DESARROLLO ACTIVADO');
  // Opcional: Usar emulador local si está corriendo
  // connectFirestoreEmulator(db, 'localhost', 8080);
}

export { db, auth, Timestamp, isDevelopment };