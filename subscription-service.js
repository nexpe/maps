// subscription-service.js
import { db, Timestamp, isDevelopment } from './firebase-config.js';
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  collection,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

class SubscriptionService {
  constructor() {
    this.TRIAL_DAYS = 7;
    this.isDevelopment = isDevelopment;
  }

  // Generar ID único de dispositivo
  getDeviceId() {
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  // ⭐ MÉTODO PRINCIPAL - Verificar suscripción usando Firebase Timestamp
  async checkSubscription() {
    const deviceId = this.getDeviceId();
    const deviceRef = doc(db, 'devices', deviceId);
    const deviceDoc = await getDoc(deviceRef);
    
    // ✅ IMPORTANTE: Usar Timestamp.now() de Firebase (hora del servidor)
    const now = Timestamp.now();
    const nowDate = now.toDate();
    
    console.log('🕐 Firebase Server Time:', nowDate.toISOString());
    console.log('🕐 Tu PC Time:', new Date().toISOString());
    console.log('📊 Diferencia:', nowDate.getTime() - new Date().getTime(), 'ms');

    // CASO 1: Primera vez que visita el dispositivo
    if (!deviceDoc.exists()) {
      // Calcular expiración del trial (3 días desde ahora EN SERVIDOR)
      const expiresSeconds = now.seconds + (this.TRIAL_DAYS * 24 * 60 * 60);
      const trialExpiresAt = new Timestamp(expiresSeconds, now.nanoseconds);
      
      // Crear registro del dispositivo
      await setDoc(deviceRef, {
        deviceId: deviceId,
        firstVisit: now,                 // Timestamp del servidor
        lastActive: now,                  // Timestamp del servidor
        status: 'trial',
        trialExpiresAt: trialExpiresAt,   // Timestamp del servidor
        createdAt: now,                    // Timestamp del servidor
        userAgent: navigator.userAgent
      });
      
      return {
        status: 'trial',
        expiresAt: trialExpiresAt.toDate(),
        message: 'Bienvenido! Tienes 3 días de prueba'
      };
    }
    
    // CASO 2: Dispositivo ya existe
    const deviceData = deviceDoc.data();
    
    // Actualizar última actividad
    await updateDoc(deviceRef, {
      lastActive: now
    });
    
    // Verificar si tiene código activo
    if (deviceData.activeCode) {
      const codeRef = doc(db, 'codes', deviceData.activeCode);
      const codeDoc = await getDoc(codeRef);
      
      if (codeDoc.exists()) {
        const codeData = codeDoc.data();
        
        // ✅ Comparar usando fechas del servidor
        if (codeData.expiresAt && codeData.expiresAt.toDate() > nowDate) {
          return {
            status: 'active',
            expiresAt: codeData.expiresAt.toDate(),
            code: deviceData.activeCode,
            message: 'Suscripción activa'
          };
        } else {
          // Código expirado - actualizar estado
          await updateDoc(deviceRef, {
            status: 'expired',
            activeCode: null
          });
        }
      }
    }
    
    // Verificar trial (usando fechas del servidor)
    if (deviceData.trialExpiresAt) {
      const trialExpiresDate = deviceData.trialExpiresAt.toDate();
      
      if (nowDate < trialExpiresDate) {
        // Trial aún activo
        return {
          status: 'trial',
          expiresAt: trialExpiresDate,
          message: 'Período de prueba activo'
        };
      } else {
        // Trial expirado
        await updateDoc(deviceRef, {
          status: 'expired'
        });
        
        return {
          status: 'expired',
          message: 'Período de prueba expirado'
        };
      }
    }
    
    return { status: 'expired' };
  }

  // ⭐ ACTIVAR CÓDIGO - Usa Firebase Timestamp
  async activateCode(code) {
    code = code.toUpperCase().trim();
    const deviceId = this.getDeviceId();
    
    // Validar formato
    if (!code.startsWith('CESAR-')) {
      return { success: false, message: '❌ Código inválido. Debe comenzar con CESAR-' };
    }
    
    // Buscar código en Firestore
    const codeRef = doc(db, 'codes', code);
    const codeDoc = await getDoc(codeRef);
    
    if (!codeDoc.exists()) {
      return { success: false, message: '❌ Código no encontrado en el sistema' };
    }
    
    const codeData = codeDoc.data();
    
    // ✅ Usar Timestamp del servidor
    const now = Timestamp.now();
    const nowDate = now.toDate();
    
    // Verificar si ya está activado
    if (codeData.status === 'active' && codeData.activatedBy !== deviceId) {
      return { 
        success: false, 
        message: '❌ Este código ya está activado en otro dispositivo' 
      };
    }
    
    if (codeData.status === 'expired') {
      return { success: false, message: '❌ Este código ya expiró' };
    }
    
    if (codeData.status === 'revoked') {
      return { success: false, message: '❌ Este código fue revocado por el administrador' };
    }
    
    // Calcular fecha de expiración (usando Timestamp)
    const durationMs = codeData.durationMs || 30 * 24 * 60 * 60 * 1000;
    const expiresSeconds = now.seconds + Math.floor(durationMs / 1000);
    const expiresAt = new Timestamp(expiresSeconds, now.nanoseconds);
    
    // Usar batch para operaciones atómicas
    const batch = writeBatch(db);
    
    // Actualizar código
    batch.update(codeRef, {
      status: 'active',
      activatedBy: deviceId,
      activatedAt: now,
      expiresAt: expiresAt,
      activatedDeviceInfo: {
        userAgent: navigator.userAgent,
        timestamp: now
      }
    });
    
    // Actualizar dispositivo
    const deviceRef = doc(db, 'devices', deviceId);
    batch.update(deviceRef, {
      status: 'active',
      activeCode: code,
      lastActive: now,
      activatedAt: now
    });
    
    // Ejecutar batch
    await batch.commit();
    
    return { 
      success: true, 
      message: `✅ ¡Código activado! Acceso por ${codeData.duration}`,
      expiresAt: expiresAt.toDate()
    };
  }

  // ⭐ REGISTRAR USO DE LA APP
  async logUsage(action, metadata = {}) {
    const deviceId = this.getDeviceId();
    const usageRef = doc(collection(db, 'usageHistory'));
    
    await setDoc(usageRef, {
      deviceId: deviceId,
      action: action,
      timestamp: Timestamp.now(),  // ✅ Hora del servidor
      metadata: metadata,
      userAgent: navigator.userAgent
    });
  }

  // ⭐ MÉTODO PARA PRUEBAS - Simular tiempo transcurrido
  async simulateTimeForTesting(daysToAdd = 0) {
    if (!this.isDevelopment) {
      console.warn('❌ Esta función solo está disponible en desarrollo');
      return;
    }
    
    const deviceId = this.getDeviceId();
    const deviceRef = doc(db, 'devices', deviceId);
    const deviceDoc = await getDoc(deviceRef);
    
    if (deviceDoc.exists()) {
      const deviceData = deviceDoc.data();
      const originalFirstVisit = deviceData.firstVisit;
      
      // Crear una fecha modificada (simular que pasaron días)
      const originalDate = originalFirstVisit.toDate();
      const simulatedDate = new Date(originalDate.getTime() - (daysToAdd * 24 * 60 * 60 * 1000));
      
      // Convertir a Timestamp
      const simulatedTimestamp = Timestamp.fromDate(simulatedDate);
      
      // Actualizar con la fecha simulada
      await updateDoc(deviceRef, {
        firstVisit: simulatedTimestamp,
        trialExpiresAt: new Timestamp(
          simulatedTimestamp.seconds + (this.TRIAL_DAYS * 24 * 60 * 60),
          simulatedTimestamp.nanoseconds
        ),
        status: 'trial',
        __test_simulation: true,
        __test_days_added: daysToAdd,
        __test_simulated_at: Timestamp.now()
      });
      
      console.log(`🧪 SIMULACIÓN: Se agregaron ${daysToAdd} días al trial`);
      console.log(`   Original: ${originalDate.toISOString()}`);
      console.log(`   Simulado: ${simulatedDate.toISOString()}`);
    }
  }

  // ⭐ RESETEAR PARA PRUEBAS
  async resetDeviceForTesting() {
    if (!this.isDevelopment) return;
    
    const deviceId = this.getDeviceId();
    const deviceRef = doc(db, 'devices', deviceId);
    
    await deleteDoc(deviceRef);
    localStorage.removeItem('device_id');
    localStorage.removeItem('activation_code');
    
    console.log('🧪 Dispositivo resetado para pruebas');
  }
}

export default SubscriptionService;