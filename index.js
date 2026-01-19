import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

// Carga las variables de entorno desde .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Variables de configuración de las APIs
const TOKEN_LEDER = process.env.TOKEN_LEDER;

app.use(cors());
app.use(express.json());

/**
 * Función para manejar consultas a API externa con GET
 */
const fetchFromExternalAPI = async (req, res, apiUrl, idParam, idValue) => {
  try {
    console.log(`🔗 Llamando a API Externa: ${req.path} con ${idParam}=${idValue}`);
    
    const response = await axios.get(apiUrl, {
      params: { [idParam]: idValue }
    });
    
    return res.status(200).json(response.data);
  } catch (err) {
    console.error("❌ Error en API Externa:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: "Error en consulta externa",
      detalle: err.response?.data || err.message,
    });
  }
};

/**
 * Función para manejar consultas específicas con múltiples parámetros
 */
const fetchFromExternalAPIMultiParams = async (req, res, apiUrl, params) => {
  try {
    console.log(`🔗 Llamando a API Externa: ${req.path} con parámetros`, params);
    
    const response = await axios.get(apiUrl, { params });
    
    return res.status(200).json(response.data);
  } catch (err) {
    console.error("❌ Error en API Externa:", err.response?.data || err.message);
    res.status(err.response?.status || 500).json({
      success: false,
      message: "Error en consulta externa",
      detalle: err.response?.data || err.message,
    });
  }
};

// ============================
// CONSULTAS SUNAT
// ============================

// SUNAT con dni_o_ruc
app.get("/sun", async (req, res) => {
  const dni_o_ruc = req.query.dni_o_ruc;
  if (!dni_o_ruc) {
    return res.status(400).json({ success: false, message: "dni_o_ruc requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/sun", 
    "dni_o_ruc", dni_o_ruc);
});

// SUNAT con query
app.get("/sunat", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/sunat", 
    "query", query);
});

// ============================
// CONSULTAS BASADAS EN DNI (8 dígitos)
// ============================

// Lista de endpoints que requieren DNI de 8 dígitos
const dniEndpoints = [
  "dni", "dnif", "dnidb", "dnifdb", "c4", "dnivaz", "dnivam", "dnivel", 
  "dniveln", "fa", "fadb", "fb", "fbdb", "cnv", "cdef", "antpen", 
  "antpol", "antjud", "actancc", "actamcc", "actadcc", "tra", "sue", 
  "cla", "sune", "cun", "colp", "mine", "afp", "antpenv", "dend", 
  "meta", "fis", "det", "rqh", "agv", "agvp"
];

// Crear endpoints automáticamente para las rutas de DNI
dniEndpoints.forEach(endpoint => {
  app.get(`/${endpoint}`, async (req, res) => {
    const dni = req.query.dni;
    if (!dni) {
      return res.status(400).json({ success: false, message: "dni requerido" });
    }
    
    await fetchFromExternalAPI(req, res, 
      `https://web-production-75681.up.railway.app/${endpoint}`, 
      "dni", dni);
  });
});

// ============================
// CONSULTAS OPCIONALES Y GENÉRICAS
// ============================

// osiptel - acepta dni o query
app.get("/osiptel", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/osiptel", 
    "dni", dni);
});

// claro - acepta dni o query
app.get("/claro", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/cla", 
    "dni", dni);
});

// entel - acepta dni o query
app.get("/entel", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/entel", 
    "dni", dni);
});

// pro - acepta dni o query
app.get("/pro", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/pro", 
    "dni", dni);
});

// sen - acepta dni o query
app.get("/sen", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/sen", 
    "dni", dni);
});

// sbs - acepta dni o query
app.get("/sbs", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/sbs", 
    "dni", dni);
});

// pasaporte - acepta dni o pasaporte
app.get("/pasaporte", async (req, res) => {
  const dni = req.query.dni || req.query.pasaporte;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o pasaporte requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/pasaporte", 
    "dni", dni);
});

// seeker - acepta dni o query
app.get("/seeker", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/seeker", 
    "dni", dni);
});

// bdir - acepta dni o query
app.get("/bdir", async (req, res) => {
  const dni = req.query.dni || req.query.query;
  if (!dni) {
    return res.status(400).json({ success: false, message: "dni o query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/bdir", 
    "dni", dni);
});

// tremp - solo query
app.get("/tremp", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/tremp", 
    "query", query);
});

// ============================
// CONSULTAS CON PARÁMETROS ESPECÍFICOS O MÚLTIPLES
// ============================

// dni_nombres - múltiples parámetros
app.get("/dni_nombres", async (req, res) => {
  const { apepaterno, apematerno, nombres } = req.query;
  
  if (!apepaterno || !apematerno) {
    return res.status(400).json({ 
      success: false, 
      message: "apepaterno y apematerno requeridos" 
    });
  }
  
  await fetchFromExternalAPIMultiParams(req, res, 
    "https://web-production-75681.up.railway.app/dni_nombres",
    { apepaterno, apematerno, nombres });
});

// venezolanos_nombres - query de nombres
app.get("/venezolanos_nombres", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    return res.status(400).json({ success: false, message: "query requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/venezolanos_nombres", 
    "query", query);
});

// dence - carnet_extranjeria
app.get("/dence", async (req, res) => {
  const carnet_extranjeria = req.query.carnet_extranjeria;
  if (!carnet_extranjeria) {
    return res.status(400).json({ success: false, message: "carnet_extranjeria requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/dence", 
    "carnet_extranjeria", carnet_extranjeria);
});

// denpas - pasaporte
app.get("/denpas", async (req, res) => {
  const pasaporte = req.query.pasaporte;
  if (!pasaporte) {
    return res.status(400).json({ success: false, message: "pasaporte requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/denpas", 
    "pasaporte", pasaporte);
});

// denci - cedula_identidad
app.get("/denci", async (req, res) => {
  const cedula_identidad = req.query.cedula_identidad;
  if (!cedula_identidad) {
    return res.status(400).json({ success: false, message: "cedula_identidad requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/denci", 
    "cedula_identidad", cedula_identidad);
});

// denp - placa
app.get("/denp", async (req, res) => {
  const placa = req.query.placa;
  if (!placa) {
    return res.status(400).json({ success: false, message: "placa requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/denp", 
    "placa", placa);
});

// denar - serie_armamento
app.get("/denar", async (req, res) => {
  const serie_armamento = req.query.serie_armamento;
  if (!serie_armamento) {
    return res.status(400).json({ success: false, message: "serie_armamento requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/denar", 
    "serie_armamento", serie_armamento);
});

// dencl - clave_denuncia
app.get("/dencl", async (req, res) => {
  const clave_denuncia = req.query.clave_denuncia;
  if (!clave_denuncia) {
    return res.status(400).json({ success: false, message: "clave_denuncia requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/dencl", 
    "clave_denuncia", clave_denuncia);
});

// cedula - cedula
app.get("/cedula", async (req, res) => {
  const cedula = req.query.cedula;
  if (!cedula) {
    return res.status(400).json({ success: false, message: "cedula requerido" });
  }
  
  await fetchFromExternalAPI(req, res, 
    "https://web-production-75681.up.railway.app/cedula", 
    "cedula", cedula);
});

// fisdet - múltiples parámetros posibles
app.get("/fisdet", async (req, res) => {
  const { caso, distritojudicial, dni, query } = req.query;
  
  // Al menos un parámetro debe estar presente
  if (!caso && !distritojudicial && !dni && !query) {
    return res.status(400).json({ 
      success: false, 
      message: "Se requiere al menos uno de: caso, distritojudicial, dni o query" 
    });
  }
  
  await fetchFromExternalAPIMultiParams(req, res, 
    "https://web-production-75681.up.railway.app/fisdet",
    { caso, distritojudicial, dni, query });
});

// ============================
// ENDPOINT DE PRUEBA/INICIO
// ============================
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "🚀 API de Consultas PERÚ - Versión Simplificada",
    description: "Sistema limpio con solo APIs GET",
    endpoints: {
      sunat: ["/sun?dni_o_ruc=20500000001", "/sunat?query=20500000001"],
      dni_based: "Más de 35 endpoints que aceptan parámetro 'dni'",
      optional: "Endpoints que aceptan dni o query",
      specific: "Endpoints con parámetros específicos o múltiples"
    },
    note: "Todas las consultas se redirigen a las nuevas APIs externas"
  });
});

// ============================
// MANEJADOR DE ERRORES 404
// ============================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint no encontrado",
    available_endpoints: [
      "/sun", "/sunat",
      "/dni", "/dnif", "/dnidb", "/dnifdb", "/c4", "/dnivaz", "/dnivam",
      "/dnivel", "/dniveln", "/fa", "/fadb", "/fb", "/fbdb", "/cnv",
      "/cdef", "/antpen", "/antpol", "/antjud", "/actancc", "/actamcc",
      "/actadcc", "/tra", "/sue", "/cla", "/sune", "/cun", "/colp",
      "/mine", "/afp", "/antpenv", "/dend", "/meta", "/fis", "/det",
      "/rqh", "/agv", "/agvp", "/osiptel", "/claro", "/entel", "/pro",
      "/sen", "/sbs", "/pasaporte", "/seeker", "/bdir", "/tremp",
      "/dni_nombres", "/venezolanos_nombres", "/dence", "/denpas",
      "/denci", "/denp", "/denar", "/dencl", "/cedula", "/fisdet"
    ]
  });
});

// ============================
// INICIAR SERVIDOR
// ============================
app.listen(PORT, () => {
  console.log(`✅ API corriendo en puerto ${PORT}`);
  console.log(`🔗 Endpoint principal: http://localhost:${PORT}`);
  console.log(`📋 Total de endpoints configurados: ${dniEndpoints.length + 20} endpoints`);
});
