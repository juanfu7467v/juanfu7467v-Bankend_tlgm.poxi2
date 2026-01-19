import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";

// Carga las variables de entorno desde .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// URL base de la nueva API (sin token requerido)
const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL;

app.use(cors());
app.use(express.json());

/* ============================
   Inicialización de Firebase
============================ */

// Configuración de Firebase desde variables de entorno con limpieza de la clave privada
const firebaseConfig = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  // Limpiar la clave privada: eliminar comillas extras y mantener saltos de línea correctos
  private_key: process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n')
    .replace(/"/g, '')
    .trim(),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN
};

// Inicializar Firebase Admin SDK
let firebaseApp;
let storage;
let bucket;

try {
  if (!admin.apps.length) {
    // Validar que la configuración mínima esté presente
    if (!firebaseConfig.private_key || !firebaseConfig.client_email || !firebaseConfig.project_id) {
      throw new Error("Configuración de Firebase incompleta. Verifica las variables de entorno.");
    }
    
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      storageBucket: process.env.BUCKET_STORAGE || "consulta-pe-abf99.firebasestorage.app"
    });
    console.log("✅ Firebase Admin SDK inicializado correctamente");
    
    // Verificar la conexión con una operación simple
    storage = admin.storage();
    bucket = storage.bucket();
    
    // Probar la conexión listando archivos (operación liviana)
    await bucket.getFiles({ maxResults: 1 });
    console.log(`✅ Firebase Storage inicializado. Bucket: ${bucket.name}`);
  } else {
    firebaseApp = admin.app();
    storage = admin.storage();
    bucket = storage.bucket();
  }
} catch (error) {
  console.error("❌ Error al inicializar Firebase:", error.message);
  console.error("Detalles del error:", error);
  
  // Si hay un error de decodificación específico, sugerir solución
  if (error.message.includes("DECODER routines") || error.message.includes("PEM")) {
    console.warn("⚠️ Posible problema con el formato de la clave privada de Firebase");
    console.warn("   Asegúrate de que FIREBASE_PRIVATE_KEY tenga el formato correcto:");
    console.warn("   - Debe comenzar con -----BEGIN PRIVATE KEY-----");
    console.warn("   - Debe terminar con -----END PRIVATE KEY-----");
    console.warn("   - Los saltos de línea deben ser \\n literales");
  }
  
  console.warn("⚠️ El sistema funcionará sin almacenamiento en Firebase");
  bucket = null;
}

/* ============================
   Funciones para Firebase Storage
============================ */

/**
 * Genera el nombre del archivo en Storage basado en el endpoint y parámetros
 */
const generateStoragePath = (endpoint, paramName, paramValue) => {
  const timestamp = Date.now();
  const safeEndpoint = endpoint.replace(/\//g, '_').replace(/^_/, '');
  const safeParamValue = paramValue.toString().replace(/[^a-zA-Z0-9]/g, '_');
  
  // Para texto/JSON
  return `consultas/${safeEndpoint}/${paramName}_${safeParamValue}_${timestamp}.json`;
};

/**
 * Genera el nombre del archivo para imágenes/PDFs
 */
const generateMediaPath = (endpoint, paramName, paramValue, extension) => {
  const timestamp = Date.now();
  const safeEndpoint = endpoint.replace(/\//g, '_').replace(/^_/, '');
  const safeParamValue = paramValue.toString().replace(/[^a-zA-Z0-9]/g, '_');
  
  return `consultas/${safeEndpoint}/media/${paramName}_${safeParamValue}_${timestamp}.${extension}`;
};

/**
 * Busca en Storage si ya existe un resultado para la consulta
 */
const checkStorageCache = async (endpoint, paramName, paramValue) => {
  if (!bucket) return null;
  
  try {
    const prefix = `consultas/${endpoint.replace(/\//g, '_').replace(/^_/, '')}/`;
    const [files] = await bucket.getFiles({ prefix, maxResults: 50 });
    
    if (files.length === 0) return null;
    
    // Buscar archivos que contengan el paramValue en su nombre
    const matchingFiles = files.filter(file => {
      const fileName = file.name.toLowerCase();
      const searchValue = paramValue.toString().toLowerCase();
      return fileName.includes(searchValue);
    });
    
    // Ordenar por fecha (más reciente primero)
    matchingFiles.sort((a, b) => {
      const timeA = a.metadata.timeCreated;
      const timeB = b.metadata.timeCreated;
      return new Date(timeB) - new Date(timeA);
    });
    
    if (matchingFiles.length > 0) {
      const latestFile = matchingFiles[0];
      
      try {
        // Descargar y leer el archivo
        const [fileContent] = await latestFile.download();
        const contentString = fileContent.toString('utf8');
        
        // Verificar si es JSON válido
        if (contentString.trim().startsWith('{') || contentString.trim().startsWith('[')) {
          const parsedContent = JSON.parse(contentString);
          console.log(`✅ Resultado encontrado en Storage: ${latestFile.name}`);
          return parsedContent;
        } else {
          // Si no es JSON, devolver como texto
          return { 
            success: true, 
            message: "Resultado desde caché",
            data: contentString,
            storageReference: latestFile.name 
          };
        }
      } catch (parseError) {
        console.warn(`⚠️ Error al parsear archivo de caché ${latestFile.name}:`, parseError.message);
        return null;
      }
    }
    
    return null;
  } catch (error) {
    console.error("❌ Error al buscar en Storage:", error.message);
    // No propagamos el error para que el sistema siga funcionando
    return null;
  }
};

/**
 * Guarda resultado de texto/JSON en Storage
 */
const saveTextToStorage = async (endpoint, paramName, paramValue, data) => {
  if (!bucket) return null;
  
  try {
    const filePath = generateStoragePath(endpoint, paramName, paramValue);
    const file = bucket.file(filePath);
    
    // Convertir a JSON si es un objeto, mantener como string si ya lo es
    const content = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
    
    await file.save(content, {
      metadata: {
        contentType: 'application/json',
        metadata: {
          endpoint: endpoint,
          paramName: paramName,
          paramValue: paramValue,
          timestamp: new Date().toISOString(),
          source: 'api-cache'
        }
      }
    });
    
    console.log(`✅ Texto guardado en Storage: ${filePath} (${content.length} bytes)`);
    return filePath;
  } catch (error) {
    console.error("❌ Error al guardar texto en Storage:", error.message);
    return null;
  }
};

/**
 * Descarga y guarda una imagen/PDF desde una URL
 */
const saveMediaFromUrl = async (endpoint, paramName, paramValue, url, contentType = 'image') => {
  if (!bucket) return null;
  
  try {
    // Determinar extensión del archivo
    let extension = 'bin';
    const urlLower = url.toLowerCase();
    
    if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) {
      extension = 'jpg';
      contentType = 'image/jpeg';
    } else if (urlLower.includes('.png')) {
      extension = 'png';
      contentType = 'image/png';
    } else if (urlLower.includes('.gif')) {
      extension = 'gif';
      contentType = 'image/gif';
    } else if (urlLower.includes('.pdf')) {
      extension = 'pdf';
      contentType = 'application/pdf';
    } else if (urlLower.includes('.webp')) {
      extension = 'webp';
      contentType = 'image/webp';
    }
    
    const filePath = generateMediaPath(endpoint, paramName, paramValue, extension);
    const file = bucket.file(filePath);
    
    // Configurar timeout para la descarga
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos timeout
    
    try {
      // Descargar el archivo desde la URL
      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'arraybuffer',
        signal: controller.signal,
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024, // 10MB límite
        validateStatus: function (status) {
          return status >= 200 && status < 300; // Solo aceptar respuestas 2xx
        }
      });
      
      clearTimeout(timeoutId);
      
      // Guardar en Firebase Storage
      await file.save(Buffer.from(response.data), {
        metadata: {
          contentType: response.headers['content-type'] || contentType,
          metadata: {
            endpoint: endpoint,
            paramName: paramName,
            paramValue: paramValue,
            originalUrl: url,
            timestamp: new Date().toISOString(),
            contentLength: response.data.length
          }
        }
      });
      
      console.log(`✅ ${contentType} guardado en Storage: ${filePath} (${response.data.length} bytes)`);
      return filePath;
    } catch (downloadError) {
      clearTimeout(timeoutId);
      
      if (downloadError.code === 'ECONNABORTED' || downloadError.name === 'AbortError') {
        console.error(`❌ Timeout al descargar ${contentType} desde ${url}`);
      } else if (downloadError.response) {
        console.error(`❌ Error HTTP ${downloadError.response.status} al descargar ${contentType}`);
      } else {
        console.error(`❌ Error al descargar ${contentType}:`, downloadError.message);
      }
      
      return null;
    }
  } catch (error) {
    console.error(`❌ Error al procesar ${contentType}:`, error.message);
    return null;
  }
};

/**
 * Función principal para manejar el caché y guardado
 */
const handleWithCache = async (req, res, apiPath, paramName, paramValue) => {
  const endpoint = req.path;
  
  // 1. Verificar si existe en Storage (si está disponible)
  if (bucket) {
    try {
      const cachedResult = await checkStorageCache(endpoint, paramName, paramValue);
      if (cachedResult) {
        return res.status(200).json(cachedResult);
      }
    } catch (cacheError) {
      console.warn("⚠️ Error en caché, procediendo con consulta API:", cacheError.message);
    }
  }
  
  // 2. Si no existe en caché o hay error, llamar a la API
  try {
    const url = `${NEW_API_BASE_URL}${apiPath}?${paramName}=${encodeURIComponent(paramValue)}`;
    console.log(`🔗 Llamando a nueva API: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 30000, // 30 segundos timeout
      headers: {
        'User-Agent': 'API-Consulta-PE/1.0'
      }
    });
    
    let resultData = response.data;
    
    // 3. Guardar en Storage (asíncrono, no bloquea la respuesta)
    if (bucket) {
      setTimeout(async () => {
        try {
          // Detectar tipo de resultado y guardar apropiadamente
          if (resultData && typeof resultData === 'object') {
            // Es JSON/texto
            await saveTextToStorage(endpoint, paramName, paramValue, resultData);
          } else if (typeof resultData === 'string') {
            // Podría ser una URL de imagen/PDF o texto plano
            if (resultData.startsWith('http')) {
              // Verificar si es imagen o PDF
              const lowerResult = resultData.toLowerCase();
              if (lowerResult.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/)) {
                await saveMediaFromUrl(endpoint, paramName, paramValue, resultData, 'image');
              } else if (lowerResult.includes('.pdf')) {
                await saveMediaFromUrl(endpoint, paramName, paramValue, resultData, 'pdf');
              } else {
                // URL no reconocida, guardar como texto
                await saveTextToStorage(endpoint, paramName, paramValue, { url: resultData });
              }
            } else {
              // Texto plano
              await saveTextToStorage(endpoint, paramName, paramValue, { text: resultData });
            }
          }
        } catch (saveError) {
          console.error("⚠️ Error al guardar en Storage (no crítico):", saveError.message);
        }
      }, 100); // Pequeño delay para no bloquear la respuesta
    }
    
    // 4. Enviar respuesta al cliente inmediatamente
    return res.status(200).json(resultData);
  } catch (err) {
    console.error("❌ Error en nueva API:", err.message);
    
    let statusCode = 500;
    let errorMessage = "Error en la consulta";
    
    if (err.response) {
      statusCode = err.response.status;
      errorMessage = err.response.data?.message || `Error ${statusCode} del servidor`;
    } else if (err.code === 'ECONNABORTED') {
      statusCode = 504;
      errorMessage = "Timeout en la consulta a la API externa";
    } else if (err.code === 'ENOTFOUND') {
      statusCode = 503;
      errorMessage = "No se pudo conectar con la API externa";
    }
    
    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      detalle: err.response?.data || err.message,
      endpoint: endpoint,
      param: { name: paramName, value: paramValue }
    });
  }
};

/* ============================
   Funciones auxiliares para las nuevas APIs (actualizadas)
============================ */

/**
 * Función centralizada para manejar las llamadas a las nuevas APIs con caché
 */
const fetchFromNewAPI = async (req, res, apiPath, paramName, paramValue) => {
  return handleWithCache(req, res, apiPath, paramName, paramValue);
};

/**
 * Función para APIs que aceptan múltiples nombres de parámetros
 */
const fetchFromNewAPIWithMultipleParamNames = async (req, res, apiPath, possibleParamNames) => {
  let paramValue = null;
  let paramName = null;
  
  // Buscar el primer parámetro que tenga valor
  for (const param of possibleParamNames) {
    if (req.query[param]) {
      paramValue = req.query[param];
      paramName = param;
      break;
    }
  }
  
  if (!paramValue) {
    return res.status(400).json({
      success: false,
      message: `Se requiere uno de los siguientes parámetros: ${possibleParamNames.join(', ')}`
    });
  }
  
  return handleWithCache(req, res, apiPath, paramName, paramValue);
};

/**
 * Función para APIs que requieren múltiples parámetros específicos
 */
const fetchFromNewAPIWithMultipleParams = async (req, res, apiPath, requiredParams) => {
  // Verificar que todos los parámetros requeridos estén presentes
  const missingParams = requiredParams.filter(param => !req.query[param]);
  
  if (missingParams.length > 0) {
    return res.status(400).json({
      success: false,
      message: `Parámetros requeridos faltantes: ${missingParams.join(', ')}`
    });
  }
  
  // Construir query string con todos los parámetros
  const queryParams = new URLSearchParams();
  requiredParams.forEach(param => {
    queryParams.append(param, req.query[param]);
  });
  
  const endpoint = req.path;
  const paramKey = requiredParams.join('_');
  const paramValue = requiredParams.map(p => req.query[p]).join('_');
  
  // 1. Verificar si existe en Storage
  if (bucket) {
    try {
      const cachedResult = await checkStorageCache(endpoint, paramKey, paramValue);
      if (cachedResult) {
        return res.status(200).json(cachedResult);
      }
    } catch (cacheError) {
      console.warn("⚠️ Error en caché para múltiples parámetros:", cacheError.message);
    }
  }
  
  // 2. Si no existe, llamar a la API
  try {
    const url = `${NEW_API_BASE_URL}${apiPath}?${queryParams.toString()}`;
    console.log(`🔗 Llamando a nueva API: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 30000
    });
    
    const resultData = response.data;
    
    // 3. Guardar en Storage (asíncrono)
    if (bucket) {
      setTimeout(async () => {
        try {
          await saveTextToStorage(endpoint, paramKey, paramValue, resultData);
        } catch (saveError) {
          console.error("⚠️ Error al guardar en Storage:", saveError.message);
        }
      }, 100);
    }
    
    // 4. Enviar respuesta al cliente
    return res.status(200).json(resultData);
  } catch (err) {
    console.error("❌ Error en nueva API:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: "Error en la consulta",
      detalle: err.response?.data || err.message,
    });
  }
};

/* ============================
   Endpoints para las nuevas APIs
============================ */

// 1. SUNAT/SUN (RUC o DNI)
app.get("/sun", async (req, res) => {
  const paramValue = req.query.dni_o_ruc || req.query.query;
  if (!paramValue) {
    return res.status(400).json({ success: false, message: "dni_o_ruc o query requerido" });
  }
  await fetchFromNewAPI(req, res, "/sun", "dni_o_ruc", paramValue);
});

app.get("/sunat", async (req, res) => {
  const paramValue = req.query.dni_o_ruc || req.query.query;
  if (!paramValue) {
    return res.status(400).json({ success: false, message: "dni_o_ruc o query requerido" });
  }
  await fetchFromNewAPI(req, res, "/sun", "dni_o_ruc", paramValue);
});

// 2. Consultas Basadas en DNI (8 dígitos)
const dniEndpoints = [
  "dni", "dnif", "dnidb", "dnifdb", "c4", "dnivaz", "dnivam", "dnivel", 
  "dniveln", "fa", "fadb", "fb", "fbdb", "cnv", "cdef", "antpen", 
  "antpol", "antjud", "actancc", "actamcc", "actadcc", "tra", "sue", 
  "cla", "sune", "cun", "colp", "mine", "afp", "antpenv", "dend", 
  "meta", "fis", "det", "rqh", "agv", "agvp"
];

dniEndpoints.forEach(endpoint => {
  app.get(`/${endpoint}`, async (req, res) => {
    const dni = req.query.dni;
    if (!dni) {
      return res.status(400).json({ success: false, message: "dni requerido" });
    }
    await fetchFromNewAPI(req, res, `/${endpoint}`, "dni", dni);
  });
});

// 3. Consultas Opcionales y Genéricas
app.get("/osiptel", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/osiptel", ["dni", "query"]);
});

app.get("/claro", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/claro", ["dni", "query"]);
});

app.get("/entel", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/entel", ["dni", "query"]);
});

app.get("/pro", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/pro", ["dni", "query"]);
});

app.get("/sen", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/sen", ["dni", "query"]);
});

app.get("/sbs", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/sbs", ["dni", "query"]);
});

app.get("/pasaporte", async (req, res) => {
  const paramValue = req.query.dni || req.query.pasaporte;
  if (!paramValue) {
    return res.status(400).json({ success: false, message: "dni o pasaporte requerido" });
  }
  const paramName = req.query.dni ? "dni" : "pasaporte";
  await fetchFromNewAPI(req, res, "/pasaporte", paramName, paramValue);
});

app.get("/seeker", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/seeker", ["dni", "query"]);
});

app.get("/bdir", async (req, res) => {
  await fetchFromNewAPIWithMultipleParamNames(req, res, "/bdir", ["dni", "query"]);
});

app.get("/tremp", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "query requerido" });
  }
  await fetchFromNewAPI(req, res, "/tremp", "query", query);
});

// 4. Consultas con Parámetros Específicos o Múltiples
app.get("/dni_nombres", async (req, res) => {
  await fetchFromNewAPIWithMultipleParams(req, res, "/dni_nombres", ["apepaterno", "apematerno"]);
});

app.get("/venezolanos_nombres", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "query requerido" });
  }
  await fetchFromNewAPI(req, res, "/venezolanos_nombres", "query", query);
});

app.get("/dence", async (req, res) => {
  const carnet = req.query.carnet_extranjeria;
  if (!carnet) {
    return res.status(400).json({ success: false, message: "carnet_extranjeria requerido" });
  }
  await fetchFromNewAPI(req, res, "/dence", "carnet_extranjeria", carnet);
});

app.get("/denpas", async (req, res) => {
  const pasaporte = req.query.pasaporte;
  if (!pasaporte) {
    return res.status(400).json({ success: false, message: "pasaporte requerido" });
  }
  await fetchFromNewAPI(req, res, "/denpas", "pasaporte", pasaporte);
});

app.get("/denci", async (req, res) => {
  const cedula = req.query.cedula_identidad;
  if (!cedula) {
    return res.status(400).json({ success: false, message: "cedula_identidad requerido" });
  }
  await fetchFromNewAPI(req, res, "/denci", "cedula_identidad", cedula);
});

app.get("/denp", async (req, res) => {
  const placa = req.query.placa;
  if (!placa) {
    return res.status(400).json({ success: false, message: "placa requerido" });
  }
  await fetchFromNewAPI(req, res, "/denp", "placa", placa);
});

app.get("/denar", async (req, res) => {
  const serie = req.query.serie_armamento;
  if (!serie) {
    return res.status(400).json({ success: false, message: "serie_armamento requerido" });
  }
  await fetchFromNewAPI(req, res, "/denar", "serie_armamento", serie);
});

app.get("/dencl", async (req, res) => {
  const clave = req.query.clave_denuncia;
  if (!clave) {
    return res.status(400).json({ success: false, message: "clave_denuncia requerido" });
  }
  await fetchFromNewAPI(req, res, "/dencl", "clave_denuncia", clave);
});

app.get("/cedula", async (req, res) => {
  const cedula = req.query.cedula;
  if (!cedula) {
    return res.status(400).json({ success: false, message: "cedula requerido" });
  }
  await fetchFromNewAPI(req, res, "/cedula", "cedula", cedula);
});

app.get("/fisdet", async (req, res) => {
  // Esta API acepta múltiples parámetros posibles
  const possibleParams = ["caso", "distritojudicial", "dni", "query"];
  let paramValue = null;
  let paramName = null;
  
  for (const param of possibleParams) {
    if (req.query[param]) {
      paramValue = req.query[param];
      paramName = param;
      break;
    }
  }
  
  if (!paramValue) {
    return res.status(400).json({
      success: false,
      message: `Se requiere uno de los siguientes parámetros: ${possibleParams.join(', ')}`
    });
  }
  
  await fetchFromNewAPI(req, res, "/fisdet", paramName, paramValue);
});

/* ============================
   Endpoints de administración de Storage
============================ */
app.get("/storage/stats", async (req, res) => {
  if (!bucket) {
    return res.status(500).json({
      success: false,
      message: "Firebase Storage no está configurado",
      configured: false,
      error: "Bucket no disponible"
    });
  }
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'consultas/', maxResults: 1000 });
    
    const stats = {
      totalFiles: files.length,
      endpoints: {},
      totalSize: 0,
      byType: {
        json: 0,
        images: 0,
        pdfs: 0,
        other: 0
      }
    };
    
    files.forEach(file => {
      const size = parseInt(file.metadata.size || 0);
      stats.totalSize += size;
      
      // Determinar tipo de archivo
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) {
        stats.byType.json++;
      } else if (name.match(/\.(jpg|jpeg|png|gif|webp)$/)) {
        stats.byType.images++;
      } else if (name.endsWith('.pdf')) {
        stats.byType.pdfs++;
      } else {
        stats.byType.other++;
      }
      
      // Agrupar por endpoint
      const pathParts = file.name.split('/');
      if (pathParts.length > 1) {
        const endpoint = pathParts[1];
        stats.endpoints[endpoint] = (stats.endpoints[endpoint] || 0) + 1;
      }
    });
    
    stats.totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
    stats.averageFileSize = files.length > 0 ? (stats.totalSize / files.length).toFixed(0) : 0;
    
    res.json({
      success: true,
      stats: stats,
      bucket: bucket.name,
      firebaseConfigured: true,
      timestamp: new Date().toISOString(),
      memoryUsage: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error al obtener estadísticas",
      error: error.message,
      configured: true
    });
  }
});

// Endpoint para limpiar caché manualmente (útil para desarrollo)
app.delete("/storage/clear", async (req, res) => {
  if (!bucket) {
    return res.status(500).json({
      success: false,
      message: "Firebase Storage no está configurado"
    });
  }
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'consultas/' });
    
    if (files.length === 0) {
      return res.json({
        success: true,
        message: "No hay archivos en caché para eliminar",
        deleted: 0
      });
    }
    
    // Eliminar archivos en lotes para no sobrecargar la memoria
    const batchSize = 100;
    let deletedCount = 0;
    
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(batch.map(file => file.delete()));
      deletedCount += batch.length;
      console.log(`🗑️ Eliminado lote de ${batch.length} archivos (total: ${deletedCount})`);
    }
    
    res.json({
      success: true,
      message: `Caché limpiado exitosamente`,
      deleted: deletedCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Error al limpiar caché:", error);
    res.status(500).json({
      success: false,
      message: "Error al limpiar caché",
      error: error.message
    });
  }
});

/* ============================
   Endpoint de prueba y estado
============================ */
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 API de Consultas PE - Versión Nueva con Firebase Storage",
    version: "1.2.0",
    nota: "Todas las consultas usan las nuevas APIs con método GET y caché en Firebase Storage",
    firebase_configured: !!bucket,
    environment: process.env.NODE_ENV || "development",
    memory: process.memoryUsage(),
    endpoints_disponibles: [
      "Consulta SUNAT: /sun o /sunat?dni_o_ruc=...",
      "Consultas por DNI: /dni, /dnif, /dnidb, etc.",
      "Consultas genéricas: /osiptel, /claro, /entel, etc.",
      "Consultas específicas: /dni_nombres, /denp, /cedula, etc.",
      "Estadísticas Storage: /storage/stats",
      "Limpiar caché: DELETE /storage/clear"
    ],
    total_endpoints: dniEndpoints.length + 22,
    cache_strategy: "Firebase Storage con verificación previa y guardado asíncrono",
    optimizations: [
      "Conexión 0.0.0.0 para Fly.io",
      "Manejo robusto de Firebase private_key",
      "Timeouts configurados",
      "Gestión de memoria optimizada"
    ]
  });
});

/* ============================
   Endpoint de salud
============================ */
app.get("/health", (req, res) => {
  const health = {
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: `${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)} MB`,
      heapTotal: `${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)} MB`,
      heapUsed: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      external: `${(process.memoryUsage().external / 1024 / 1024).toFixed(2)} MB`
    },
    services: {
      api_base_url: !!NEW_API_BASE_URL,
      firebase_storage: !!bucket,
      total_endpoints: dniEndpoints.length + 22
    }
  };
  
  res.json(health);
});

/* ============================
   Manejo de errores 404
============================ */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint no encontrado",
    path: req.path,
    available_endpoints: [
      "/ - Documentación",
      "/health - Estado del sistema",
      "/storage/stats - Estadísticas de Storage",
      "/sun, /sunat - Consultas SUNAT",
      "/dni, /c4, /tra, etc. - Consultas por DNI",
      "... y muchos más (ver / para lista completa)"
    ]
  });
});

/* ============================
   Manejo de errores global
============================ */
app.use((err, req, res, next) => {
  console.error("💥 Error global no manejado:", err);
  
  res.status(500).json({
    success: false,
    message: "Error interno del servidor",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    timestamp: new Date().toISOString()
  });
});

/* ============================
   Servidor - CORREGIDO para Fly.io
============================ */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API nueva corriendo en 0.0.0.0:${PORT}`);
  console.log(`🌐 URL base de APIs: ${NEW_API_BASE_URL || "No configurada - verificar variable de entorno NEW_API_BASE_URL"}`);
  console.log(`🔥 Firebase Storage: ${bucket ? "Configurado correctamente ✓" : "No configurado ⚠️"}`);
  console.log(`📦 Bucket: ${process.env.BUCKET_STORAGE || "No especificado"}`);
  console.log(`💾 Memoria inicial: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🚀 Listo para recibir conexiones en todas las interfaces de red`);
});

export default app;
