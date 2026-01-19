import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import admin from "firebase-admin";
import { Storage } from "@google-cloud/storage";

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

// Configuración de Firebase desde variables de entorno
const firebaseConfig = {
  type: process.env.FIREBASE_TYPE,
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      storageBucket: process.env.BUCKET_STORAGE
    });
    console.log("✅ Firebase Admin SDK inicializado correctamente");
  } else {
    firebaseApp = admin.app();
  }
  
  storage = admin.storage();
  bucket = storage.bucket();
  console.log(`✅ Firebase Storage inicializado. Bucket: ${process.env.BUCKET_STORAGE}`);
} catch (error) {
  console.error("❌ Error al inicializar Firebase:", error.message);
  console.warn("⚠️ El sistema funcionará sin almacenamiento en Firebase");
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
    const [files] = await bucket.getFiles({ prefix });
    
    // Buscar archivos que contengan el paramValue en su nombre
    const matchingFiles = files.filter(file => 
      file.name.includes(`${paramName}_${paramValue}_`) || 
      file.name.includes(paramValue)
    );
    
    // Ordenar por fecha (más reciente primero)
    matchingFiles.sort((a, b) => {
      const timeA = a.metadata.timeCreated;
      const timeB = b.metadata.timeCreated;
      return new Date(timeB) - new Date(timeA);
    });
    
    if (matchingFiles.length > 0) {
      const latestFile = matchingFiles[0];
      
      // Descargar y leer el archivo
      const [fileContent] = await latestFile.download();
      const contentString = fileContent.toString();
      
      try {
        const parsedContent = JSON.parse(contentString);
        console.log(`✅ Resultado encontrado en Storage: ${latestFile.name}`);
        return parsedContent;
      } catch (error) {
        // Si no es JSON, podría ser una referencia a un archivo binario
        return { storageReference: latestFile.name, rawContent: contentString };
      }
    }
    
    return null;
  } catch (error) {
    console.error("❌ Error al buscar en Storage:", error.message);
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
    
    const content = JSON.stringify(data, null, 2);
    await file.save(content, {
      metadata: {
        contentType: 'application/json',
        metadata: {
          endpoint: endpoint,
          paramName: paramName,
          paramValue: paramValue,
          timestamp: new Date().toISOString()
        }
      }
    });
    
    console.log(`✅ Texto guardado en Storage: ${filePath}`);
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
    if (contentType.includes('image')) {
      extension = url.split('.').pop().split('?')[0] || 'jpg';
    } else if (contentType.includes('pdf')) {
      extension = 'pdf';
    }
    
    const filePath = generateMediaPath(endpoint, paramName, paramValue, extension);
    const file = bucket.file(filePath);
    
    // Descargar el archivo desde la URL
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });
    
    // Configurar el tipo de contenido
    const writeStream = file.createWriteStream({
      metadata: {
        contentType: response.headers['content-type'] || contentType,
        metadata: {
          endpoint: endpoint,
          paramName: paramName,
          paramValue: paramValue,
          originalUrl: url,
          timestamp: new Date().toISOString()
        }
      }
    });
    
    // Pipe del stream de respuesta al stream de escritura
    response.data.pipe(writeStream);
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        console.log(`✅ ${contentType} guardado en Storage: ${filePath}`);
        resolve(filePath);
      });
      
      writeStream.on('error', (error) => {
        console.error(`❌ Error al guardar ${contentType} en Storage:`, error.message);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`❌ Error al descargar/guardar ${contentType}:`, error.message);
    return null;
  }
};

/**
 * Función principal para manejar el caché y guardado
 */
const handleWithCache = async (req, res, apiPath, paramName, paramValue) => {
  const endpoint = req.path;
  
  // 1. Verificar si existe en Storage
  const cachedResult = await checkStorageCache(endpoint, paramName, paramValue);
  if (cachedResult) {
    return res.status(200).json(cachedResult);
  }
  
  // 2. Si no existe, llamar a la API
  try {
    const url = `${NEW_API_BASE_URL}${apiPath}?${paramName}=${paramValue}`;
    console.log(`🔗 Llamando a nueva API: ${url}`);
    
    const response = await axios.get(url);
    const resultData = response.data;
    
    // 3. Guardar en Storage (asíncrono, no bloquea la respuesta)
    setTimeout(async () => {
      try {
        // Detectar tipo de resultado y guardar apropiadamente
        if (typeof resultData === 'object') {
          // Es JSON/texto
          await saveTextToStorage(endpoint, paramName, paramValue, resultData);
        } else if (typeof resultData === 'string') {
          // Podría ser una URL de imagen/PDF o texto plano
          if (resultData.startsWith('http')) {
            // Verificar si es imagen o PDF
            const lowerResult = resultData.toLowerCase();
            if (lowerResult.includes('.jpg') || lowerResult.includes('.jpeg') || 
                lowerResult.includes('.png') || lowerResult.includes('.gif')) {
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
    }, 0); // setTimeout con 0 para ejecutar después de enviar la respuesta
    
    // 4. Enviar respuesta al cliente inmediatamente
    return res.status(200).json(resultData);
  } catch (err) {
    console.error("❌ Error en nueva API:", err.response?.data || err.message);
    
    const statusCode = err.response?.status || 500;
    const errorMessage = err.response?.data?.message || err.message || "Error en la consulta";
    
    res.status(statusCode).json({
      success: false,
      message: "Error en la consulta",
      detalle: errorMessage,
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
  const cachedResult = await checkStorageCache(endpoint, paramKey, paramValue);
  if (cachedResult) {
    return res.status(200).json(cachedResult);
  }
  
  // 2. Si no existe, llamar a la API
  try {
    const url = `${NEW_API_BASE_URL}${apiPath}?${queryParams.toString()}`;
    console.log(`🔗 Llamando a nueva API: ${url}`);
    
    const response = await axios.get(url);
    const resultData = response.data;
    
    // 3. Guardar en Storage (asíncrono)
    setTimeout(async () => {
      try {
        await saveTextToStorage(endpoint, paramKey, paramValue, resultData);
      } catch (saveError) {
        console.error("⚠️ Error al guardar en Storage:", saveError.message);
      }
    }, 0);
    
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
      message: "Firebase Storage no está configurado"
    });
  }
  
  try {
    const [files] = await bucket.getFiles({ prefix: 'consultas/' });
    
    const stats = {
      totalFiles: files.length,
      endpoints: {},
      totalSize: 0
    };
    
    files.forEach(file => {
      const size = parseInt(file.metadata.size || 0);
      stats.totalSize += size;
      
      // Agrupar por endpoint
      const pathParts = file.name.split('/');
      if (pathParts.length > 1) {
        const endpoint = pathParts[1];
        stats.endpoints[endpoint] = (stats.endpoints[endpoint] || 0) + 1;
      }
    });
    
    stats.totalSizeMB = (stats.totalSize / (1024 * 1024)).toFixed(2);
    
    res.json({
      success: true,
      stats: stats,
      bucket: process.env.BUCKET_STORAGE,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error al obtener estadísticas",
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
    version: "1.1.0",
    nota: "Todas las consultas usan las nuevas APIs con método GET y caché en Firebase Storage",
    firebase_configured: !!bucket,
    endpoints_disponibles: [
      "Consulta SUNAT: /sun o /sunat?dni_o_ruc=...",
      "Consultas por DNI: /dni, /dnif, /dnidb, etc.",
      "Consultas genéricas: /osiptel, /claro, /entel, etc.",
      "Consultas específicas: /dni_nombres, /denp, /cedula, etc.",
      "Estadísticas Storage: /storage/stats"
    ],
    total_endpoints: dniEndpoints.length + 21,
    cache_strategy: "Firebase Storage con verificación previa y guardado asíncrono"
  });
});

/* ============================
   Endpoint de salud
============================ */
app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
    api_base_url_configured: !!NEW_API_BASE_URL,
    firebase_storage_configured: !!bucket,
    environment: process.env.NODE_ENV || "development"
  });
});

/* ============================
   Manejo de errores 404
============================ */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint no encontrado",
    path: req.path
  });
});

/* ============================
   Servidor
============================ */
app.listen(PORT, () => {
  console.log(`✅ API nueva corriendo en puerto ${PORT}`);
  console.log(`🌐 URL base de APIs: ${NEW_API_BASE_URL || "No configurada - verificar variable de entorno NEW_API_BASE_URL"}`);
  console.log(`🔥 Firebase Storage: ${bucket ? "Configurado correctamente" : "No configurado"}`);
  console.log(`📦 Bucket: ${process.env.BUCKET_STORAGE || "No especificado"}`);
});

export default app;
