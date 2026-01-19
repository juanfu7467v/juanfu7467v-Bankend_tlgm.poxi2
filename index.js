import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

// Carga las variables de entorno desde .env
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// URL base de la nueva API (sin token requerido)
const NEW_API_BASE_URL = process.env.NEW_API_BASE_URL;

app.use(cors());
app.use(express.json());

/* ============================
   Funciones auxiliares para las nuevas APIs
============================ */

/**
 * Función centralizada para manejar las llamadas a las nuevas APIs
 */
const fetchFromNewAPI = async (req, res, apiPath, paramName, paramValue) => {
    try {
        // Construir la URL completa usando la base desde secrets
        const url = `${NEW_API_BASE_URL}${apiPath}?${paramName}=${paramValue}`;
        
        console.log(`🔗 Llamando a nueva API: ${url}`);

        const response = await axios.get(url);
        const resultData = response.data;
        
        return res.status(200).json(resultData);
    } catch (err) {
        console.error("❌ Error en nueva API:", err.response?.data || err.message);
        
        // Manejar diferentes tipos de errores
        const statusCode = err.response?.status || 500;
        const errorMessage = err.response?.data?.message || err.message || "Error en la consulta";
        
        res.status(statusCode).json({
            success: false,
            message: "Error en la consulta",
            detalle: errorMessage,
        });
    }
};

/**
 * Función para APIs que aceptan múltiples nombres de parámetros
 */
const fetchFromNewAPIWithMultipleParamNames = async (req, res, apiPath, possibleParamNames) => {
    try {
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
        
        const url = `${NEW_API_BASE_URL}${apiPath}?${paramName}=${paramValue}`;
        console.log(`🔗 Llamando a nueva API: ${url}`);

        const response = await axios.get(url);
        const resultData = response.data;
        
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

/**
 * Función para APIs que requieren múltiples parámetros específicos
 */
const fetchFromNewAPIWithMultipleParams = async (req, res, apiPath, requiredParams) => {
    try {
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
        
        const url = `${NEW_API_BASE_URL}${apiPath}?${queryParams.toString()}`;
        console.log(`🔗 Llamando a nueva API: ${url}`);

        const response = await axios.get(url);
        const resultData = response.data;
        
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
   Endpoint de prueba y estado
============================ */
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "🚀 API de Consultas PE - Versión Nueva",
        version: "1.0.0",
        nota: "Todas las consultas usan las nuevas APIs con método GET",
        endpoints_disponibles: [
            "Consulta SUNAT: /sun o /sunat?dni_o_ruc=...",
            "Consultas por DNI: /dni, /dnif, /dnidb, etc.",
            "Consultas genéricas: /osiptel, /claro, /entel, etc.",
            "Consultas específicas: /dni_nombres, /denp, /cedula, etc."
        ],
        total_endpoints: dniEndpoints.length + 20 // Aproximado
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
        api_base_url_configured: !!NEW_API_BASE_URL
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
});

export default app;
