// admin-service.js
import { db, Timestamp, auth } from './firebase-config.js';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs,
  query, 
  where, 
  orderBy, 
  updateDoc,
  deleteDoc,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';
import { 
  signInWithEmailAndPassword, 
  signOut 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

class AdminService {
  
  // Login de administrador
  async loginAdmin(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      
      // Actualizar último login
      const adminRef = doc(db, 'admins', userCredential.user.uid);
      await updateDoc(adminRef, {
        lastLogin: Timestamp.now(),
        lastLoginIP: await this.getClientIP()
      });
      
      return { success: true, user: userCredential.user };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // Obtener IP del cliente
  async getClientIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch {
      return 'unknown';
    }
  }

  // Logout
  async logoutAdmin() {
    await signOut(auth);
  }

  // Generar nuevo código (SIEMPRE con Timestamp)
  async generateCode(clientName, duration, adminId) {
    // Limpiar nombre
    const cleanName = clientName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .substr(0, 10);
    
    const code = `CESAR-${cleanName}-${duration}`;
    
    // Mapeo de duración a milisegundos
    const durationMsMap = {
      '1H': 60 * 60 * 1000,
      '3H': 3 * 60 * 60 * 1000,
      '1D': 24 * 60 * 60 * 1000,
      '3D': 3 * 24 * 60 * 60 * 1000,
      '7D': 7 * 24 * 60 * 60 * 1000,
      '15D': 15 * 24 * 60 * 60 * 1000,
      '30D': 30 * 24 * 60 * 60 * 1000,
      '90D': 90 * 24 * 60 * 60 * 1000,
      '180D': 180 * 24 * 60 * 60 * 1000,
      '365D': 365 * 24 * 60 * 60 * 1000,
      'UNLIMITED': 10 * 365 * 24 * 60 * 60 * 1000
    };
    
    // ✅ Usar Timestamp de Firebase
    const now = Timestamp.now();
    
    const codeData = {
      code: code,
      clientName: clientName,
      duration: duration,
      durationMs: durationMsMap[duration] || 30 * 24 * 60 * 60 * 1000,
      generatedBy: adminId,
      generatedAt: now,           // ✅ Timestamp del servidor
      status: 'generated',
      activatedBy: null,
      activatedAt: null,
      expiresAt: null,
      notes: '',
      qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${code}`
    };
    
    // Guardar en Firestore
    const codeRef = doc(db, 'codes', code);
    await setDoc(codeRef, codeData);
    
    return { success: true, code: code, data: codeData };
  }

  // Obtener todos los códigos (convertir Timestamps a fechas)
  async getAllCodes(filters = {}) {
    let constraints = [orderBy('generatedAt', 'desc')];
    
    if (filters.status) {
      constraints.push(where('status', '==', filters.status));
    }
    
    const q = query(collection(db, 'codes'), ...constraints);
    const querySnapshot = await getDocs(q);
    const codes = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      codes.push({
        id: doc.id,
        ...data,
        // Convertir Timestamps a Date para fácil manejo
        generatedAt: data.generatedAt?.toDate(),
        activatedAt: data.activatedAt?.toDate(),
        expiresAt: data.expiresAt?.toDate()
      });
    });
    
    return codes;
  }

  // Obtener estadísticas en tiempo real
  async getStats() {
    const codes = await this.getAllCodes();
    const devicesSnapshot = await getDocs(collection(db, 'devices'));
    const now = new Date();
    
    const stats = {
      totalCodes: codes.length,
      generated: codes.filter(c => c.status === 'generated').length,
      active: codes.filter(c => c.status === 'active').length,
      expired: codes.filter(c => c.status === 'expired').length,
      revoked: codes.filter(c => c.status === 'revoked').length,
      totalDevices: devicesSnapshot.size,
      activeDevices: 0,
      trialDevices: 0,
      expiredDevices: 0
    };
    
    // Calcular dispositivos activos (usando fechas reales)
    devicesSnapshot.forEach(doc => {
      const device = doc.data();
      if (device.status === 'active') stats.activeDevices++;
      if (device.status === 'trial') {
        // Verificar si el trial realmente está activo
        if (device.trialExpiresAt && device.trialExpiresAt.toDate() > now) {
          stats.trialDevices++;
        }
      }
      if (device.status === 'expired') stats.expiredDevices++;
    });
    
    return stats;
  }

  // Revocar código
  async revokeCode(code) {
    const codeRef = doc(db, 'codes', code);
    await updateDoc(codeRef, {
      status: 'revoked',
      revokedAt: Timestamp.now(),
      revokedBy: auth.currentUser?.uid
    });
    
    return { success: true };
  }

  // Eliminar código (solo si no está activo)
  async deleteCode(code) {
    const codeRef = doc(db, 'codes', code);
    const codeDoc = await getDoc(codeRef);
    
    if (codeDoc.exists() && codeDoc.data().status !== 'active') {
      await deleteDoc(codeRef);
      return { success: true };
    } else {
      return { success: false, message: 'No se puede eliminar un código activo' };
    }
  }

  // Exportar datos a CSV
  async exportCodesToCSV() {
    const codes = await this.getAllCodes();
    
    let csv = 'Código,Cliente,Duración,Estado,Fecha Generación,Fecha Activación,Expira,Dispositivo\n';
    
    codes.forEach(code => {
      csv += `"${code.code}","${code.clientName}","${code.duration}","${code.status}",`;
      csv += `"${code.generatedAt?.toLocaleDateString() || ''}",`;
      csv += `"${code.activatedAt?.toLocaleDateString() || ''}",`;
      csv += `"${code.expiresAt?.toLocaleDateString() || ''}",`;
      csv += `"${code.activatedBy || ''}"\n`;
    });
    
    return csv;
  }
}

export default AdminService;