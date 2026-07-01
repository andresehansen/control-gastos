/* ==========================================================================
   LÓGICA DE NEGOCIO Y CONEXIÓN CON SUPABASE (Control de Gastos)
   ========================================================================== */

// Categorías según el tipo de transacción
const CATEGORIAS_GASTOS = ['Comida', 'Servicios', 'Salidas/Entretenimiento', 'Transporte', 'Salud', 'Educación', 'Otros Gastos'];
const CATEGORIAS_INGRESOS = ['Sueldo', 'Inversiones', 'Venta', 'Otros Ingresos'];

// Estado de la aplicación
let supabaseClient = null;
let currentUser = null;
let transacciones = [];
let presupuestos = [];

// Instancias de Gráficos (para destruirlos/re-renderizarlos)
let chartPieInstance = null;
let chartBarInstance = null;

// Elementos del DOM
const views = {
    setup: document.getElementById('setup-view'),
    auth: document.getElementById('auth-view'),
    dashboard: document.getElementById('dashboard-view'),
    transactions: document.getElementById('transactions-view'),
    budgets: document.getElementById('budgets-view'),
    config: document.getElementById('config-view')
};

// ==========================================================================
   // 1. INICIALIZACIÓN Y CONFIGURACIÓN DE CREDENCIALES
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    inicializarNavegacion();
    cargarCredencialesSupabase();
    
    // Configurar categorías iniciales
    cambiarCategoriasFormulario('gasto');
    
    // Evento de cambio de tipo en el formulario (Gasto/Ingreso)
    document.querySelectorAll('.btn-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            const type = e.target.dataset.type;
            cambiarCategoriasFormulario(type);
        });
    });

    // Guardar credenciales de Supabase
    document.getElementById('setup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        let url = document.getElementById('setup-url').value.trim();
        const key = document.getElementById('setup-key').value.trim();
        
        // Limpiar URL si termina en barras o en /rest/v1/
        url = url.replace(/\/+$/, ""); // Quita barras al final
        url = url.replace(/\/rest\/v1$/, ""); // Quita rest/v1 si lo tiene
        
        localStorage.setItem('supabase_url', url);
        localStorage.setItem('supabase_key', key);
        
        cargarCredencialesSupabase();
    });

    // Desconectar Supabase
    document.getElementById('btn-reset-setup').addEventListener('click', () => {
        if(confirm('¿Seguro que deseas desconectar la base de datos de Supabase? Se cerrará la sesión.')) {
            localStorage.removeItem('supabase_url');
            localStorage.removeItem('supabase_key');
            supabaseClient = null;
            currentUser = null;
            mostrarVista('setup');
            document.getElementById('btn-logout').style.display = 'none';
        }
    });

    // Registrar transacciones
    document.getElementById('tx-form').addEventListener('submit', guardarTransaccion);

    // Registrar presupuesto
    document.getElementById('budget-form').addEventListener('submit', guardarPresupuesto);

    // Registrar / Iniciar Sesión de usuario
    document.getElementById('auth-form').addEventListener('submit', manejarAutenticacion);
    
    // Tabs de Auth (Cambiar entre Login y Registro)
    document.getElementById('tab-login').addEventListener('click', () => cambiarAuthTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => cambiarAuthTab('register'));

    // Botón de cerrar sesión
    document.getElementById('btn-logout').addEventListener('click', cerrarSesion);

    // Filtros interactivos
    document.getElementById('filter-mes').addEventListener('change', renderizarTransaccionesYFiltros);
    document.getElementById('filter-categoria').addEventListener('change', renderizarTransaccionesYFiltros);
});

// Cargar credenciales guardadas en LocalStorage
function cargarCredencialesSupabase() {
    let url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');

    if (url && key) {
        try {
            // Limpiar URL por seguridad
            url = url.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
            
            // Inicializar cliente Supabase
            supabaseClient = supabase.createClient(url, key);
            document.getElementById('current-url').value = url;
            comprobarSesionActiva();
        } catch (error) {
            alert('Error al conectar con Supabase. Revisa las credenciales.');
            mostrarVista('setup');
        }
    } else {
        mostrarVista('setup');
    }
}

// ==========================================================================
// 2. SISTEMA DE AUTENTICACIÓN
// ==========================================================================

let authMode = 'login'; // 'login' o 'register'

function cambiarAuthTab(mode) {
    authMode = mode;
    document.querySelectorAll('.auth-tab').forEach(tab => tab.classList.remove('active'));
    
    if (mode === 'login') {
        document.getElementById('tab-login').classList.add('active');
        document.getElementById('btn-auth-submit').textContent = 'Ingresar';
    } else {
        document.getElementById('tab-register').classList.add('active');
        document.getElementById('btn-auth-submit').textContent = 'Registrarse';
    }
}

async function manejarAutenticacion(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;

    try {
        let response;
        if (authMode === 'login') {
            response = await supabaseClient.auth.signInWithPassword({ email, password });
        } else {
            response = await supabaseClient.auth.signUp({ email, password });
            alert('¡Registro exitoso! Ya puedes iniciar sesión con tu cuenta.');
            cambiarAuthTab('login');
            return;
        }

        if (response.error) throw response.error;

        currentUser = response.data.user;
        document.getElementById('btn-logout').style.display = 'block';
        mostrarVista('dashboard');
        await cargarDatos();
    } catch (error) {
        alert('Error en autenticación: ' + error.message);
    }
}

async function comprobarSesionActiva() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session) {
        currentUser = session.user;
        document.getElementById('btn-logout').style.display = 'block';
        mostrarVista('dashboard');
        await cargarDatos();
    } else {
        mostrarVista('auth');
    }
}

async function cerrarSesion() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
        currentUser = null;
        transacciones = [];
        presupuestos = [];
        document.getElementById('btn-logout').style.display = 'none';
        mostrarVista('auth');
    }
}

// ==========================================================================
// 3. OPERACIONES DE BASE DE DATOS Y CARGA DE DATOS
// ==========================================================================

async function cargarDatos() {
    if (!supabaseClient || !currentUser) return;

    try {
        // Cargar Transacciones
        let { data: txData, error: txError } = await supabaseClient
            .from('transacciones')
            .select('*')
            .order('fecha', { ascending: false });

        if (txError) throw txError;
        transacciones = txData || [];

        // Cargar Presupuestos
        let { data: bData, error: bError } = await supabaseClient
            .from('presupuestos')
            .select('*');

        if (bError) throw bError;
        presupuestos = bData || [];

        // Rellenar select de filtros de categorías en el listado
        const catFilter = document.getElementById('filter-categoria');
        catFilter.innerHTML = '<option value="todas">Todas las Categorías</option>';
        [...CATEGORIAS_GASTOS, ...CATEGORIAS_INGRESOS].forEach(cat => {
            catFilter.innerHTML += `<option value="${cat}">${cat}</option>`;
        });

        // Actualizar UI
        actualizarResumenFinanciero();
        renderizarTransaccionesYFiltros();
        actualizarProgresoPresupuestos();
        renderizarGraficos();
    } catch (error) {
        console.error('Error al cargar datos de Supabase:', error.message);
    }
}

async function guardarTransaccion(e) {
    e.preventDefault();
    if (!supabaseClient || !currentUser) return;

    const tipo = document.querySelector('.btn-toggle.active').dataset.type;
    const rawMonto = parseFloat(document.getElementById('tx-monto').value);
    const monto = tipo === 'gasto' ? -Math.abs(rawMonto) : Math.abs(rawMonto);
    const categoria = document.getElementById('tx-categoria').value;
    const fecha = document.getElementById('tx-fecha').value;
    const metodo_pago = document.getElementById('tx-metodo').value;
    const descripcion = document.getElementById('tx-descripcion').value.trim();

    try {
        const { error } = await supabaseClient
            .from('transacciones')
            .insert([{
                user_id: currentUser.id,
                monto,
                tipo,
                categoria,
                fecha,
                metodo_pago,
                descripcion
            }]);

        if (error) throw error;

        document.getElementById('tx-form').reset();
        cambiarCategoriasFormulario(tipo);
        establecerFechaHoy();
        await cargarDatos();
        alert('Registro guardado exitosamente.');
    } catch (error) {
        alert('Error al guardar: ' + error.message);
    }
}

async function eliminarTransaccion(id) {
    if (!confirm('¿Seguro que deseas eliminar esta transacción?')) return;

    try {
        const { error } = await supabaseClient
            .from('transacciones')
            .delete()
            .eq('id', id);

        if (error) throw error;

        await cargarDatos();
    } catch (error) {
        alert('Error al eliminar: ' + error.message);
    }
}

async function guardarPresupuesto(e) {
    e.preventDefault();
    if (!supabaseClient || !currentUser) return;

    const categoria = document.getElementById('budget-categoria').value;
    const monto_limite = parseFloat(document.getElementById('budget-monto').value);

    try {
        // Comprobar si ya existe presupuesto para esa categoría para actualizar o insertar
        const existe = presupuestos.find(b => b.categoria === categoria);
        
        let error;
        if (existe) {
            let res = await supabaseClient
                .from('presupuestos')
                .update({ monto_limite })
                .eq('id', existe.id);
            error = res.error;
        } else {
            let res = await supabaseClient
                .from('presupuestos')
                .insert([{ user_id: currentUser.id, categoria, monto_limite }]);
            error = res.error;
        }

        if (error) throw error;

        document.getElementById('budget-form').reset();
        await cargarDatos();
        alert('Límite de presupuesto configurado correctamente.');
    } catch (error) {
        alert('Error al guardar presupuesto: ' + error.message);
    }
}

// ==========================================================================
// 4. LÓGICA DE UI Y RENDERIZADO
// ==========================================================================

function cambiarCategoriasFormulario(tipo) {
    const select = document.getElementById('tx-categoria');
    select.innerHTML = '';
    const categorias = tipo === 'gasto' ? CATEGORIAS_GASTOS : CATEGORIAS_INGRESOS;
    categorias.forEach(cat => {
        select.innerHTML += `<option value="${cat}">${cat}</option>`;
    });
}

function establecerFechaHoy() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('tx-fecha').value = today;
}

// Filtra las transacciones del mes en curso para los indicadores superiores
function actualizarResumenFinanciero() {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    const transaccionesMes = transacciones.filter(t => {
        const f = new Date(t.fecha + 'T00:00:00');
        return f.getMonth() === mesActual && f.getFullYear() === anioActual;
    });

    let ingresos = 0;
    let gastos = 0;

    transaccionesMes.forEach(t => {
        if (t.monto > 0) ingresos += t.monto;
        else gastos += Math.abs(t.monto);
    });

    const balance = ingresos - gastos;

    document.getElementById('total-ingresos').textContent = `$${ingresos.toFixed(2)}`;
    document.getElementById('total-gastos').textContent = `$${gastos.toFixed(2)}`;
    
    const balanceEl = document.getElementById('total-balance');
    balanceEl.textContent = `$${balance.toFixed(2)}`;
    if (balance < 0) {
        balanceEl.style.color = 'var(--danger)';
    } else {
        balanceEl.style.color = 'var(--success)';
    }
}

// Renderizar tabla/lista de transacciones con filtros aplicados
function renderizarTransaccionesYFiltros() {
    const filterMes = document.getElementById('filter-mes').value;
    const filterCategoria = document.getElementById('filter-categoria').value;
    const container = document.getElementById('transaction-list-container');
    container.innerHTML = '';

    const transaccionesFiltradas = transacciones.filter(t => {
        const fechaTx = new Date(t.fecha + 'T00:00:00');
        const cumpleMes = filterMes === 'todos' || fechaTx.getMonth().toString() === filterMes;
        const cumpleCat = filterCategoria === 'todas' || t.categoria === filterCategoria;
        return cumpleMes && cumpleCat;
    });

    if (transaccionesFiltradas.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No se encontraron registros.</div>`;
        return;
    }

    transaccionesFiltradas.forEach(t => {
        const item = document.createElement('div');
        item.className = `transaction-item ${t.tipo}`;
        
        const fechaFormateada = new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-ES', {
            day: '2-digit', month: 'short', year: 'numeric'
        });

        item.innerHTML = `
            <div class="tx-info">
                <h4>${t.categoria}</h4>
                <span>${fechaFormateada} • ${t.metodo_pago} ${t.descripcion ? `• ${t.descripcion}` : ''}</span>
            </div>
            <div class="tx-amount-area">
                <span class="tx-amount ${t.tipo}">$${Math.abs(t.monto).toFixed(2)}</span>
                <button class="btn-delete" data-id="${t.id}">✕</button>
            </div>
        `;
        
        // Asignar evento de borrado
        item.querySelector('.btn-delete').addEventListener('click', (e) => {
            eliminarTransaccion(e.target.dataset.id);
        });

        container.appendChild(item);
    });
}

// Progreso mensual vs presupuestos límites establecidos
function actualizarProgresoPresupuestos() {
    const container = document.getElementById('budget-progress-container');
    container.innerHTML = '';

    if (presupuestos.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Establece límites mensuales en el panel izquierdo.</div>`;
        return;
    }

    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    presupuestos.forEach(b => {
        // Calcular gasto actual del mes para esta categoría
        const gastado = transacciones
            .filter(t => {
                const f = new Date(t.fecha + 'T00:00:00');
                return t.tipo === 'gasto' && t.categoria === b.categoria && f.getMonth() === mesActual && f.getFullYear() === anioActual;
            })
            .reduce((sum, t) => sum + Math.abs(t.monto), 0);

        const porcentaje = Math.min((gastado / b.monto_limite) * 100, 100);
        let colorClase = '';
        if (porcentaje >= 100) colorClase = 'danger';
        else if (porcentaje >= 80) colorClase = 'warning';

        const item = document.createElement('div');
        item.className = 'budget-item';
        item.innerHTML = `
            <div class="budget-info">
                <span>${b.categoria}</span>
                <span>$${gastado.toFixed(2)} / $${b.monto_limite.toFixed(2)}</span>
            </div>
            <div class="budget-progress-bar">
                <div class="budget-progress-fill ${colorClase}" style="width: ${porcentaje}%"></div>
            </div>
        `;
        container.appendChild(item);
    });
}

// ==========================================================================
// 5. CÁLCULO Y RENDERIZADO DE GRÁFICOS (Chart.js)
// ==========================================================================

function renderizarGraficos() {
    const hoy = new Date();
    const mesActual = hoy.getMonth();
    const anioActual = hoy.getFullYear();

    // 1. Datos para gráfico de Torta (Distribución de Gastos en el mes actual)
    const gastosPorCat = {};
    CATEGORIAS_GASTOS.forEach(cat => gastosPorCat[cat] = 0);

    transacciones.forEach(t => {
        const f = new Date(t.fecha + 'T00:00:00');
        if (t.tipo === 'gasto' && f.getMonth() === mesActual && f.getFullYear() === anioActual) {
            gastosPorCat[t.categoria] = (gastosPorCat[t.categoria] || 0) + Math.abs(t.monto);
        }
    });

    const pieLabels = Object.keys(gastosPorCat).filter(cat => gastosPorCat[cat] > 0);
    const pieData = pieLabels.map(cat => gastosPorCat[cat]);

    // Destruir grafico previo si existe
    if (chartPieInstance) chartPieInstance.destroy();

    const ctxPie = document.getElementById('chart-pie').getContext('2d');
    if (pieData.length > 0) {
        chartPieInstance = new Chart(ctxPie, {
            type: 'doughnut',
            data: {
                labels: pieLabels,
                datasets: [{
                    data: pieData,
                    backgroundColor: [
                        '#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#64748b'
                    ],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() } }
                }
            }
        });
    } else {
        // Si no hay datos, mostrar vacío
        ctxPie.clearRect(0, 0, 300, 300);
    }

    // 2. Datos para gráfico de Barras (Historial mensual últimos 4 meses)
    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const ultimosMeses = [];
    for (let i = 3; i >= 0; i--) {
        const d = new Date();
        d.setMonth(hoy.getMonth() - i);
        ultimosMeses.push({
            mes: d.getMonth(),
            anio: d.getFullYear(),
            nombre: mesesNombres[d.getMonth()]
        });
    }

    const ingresosBarras = [0, 0, 0, 0];
    const gastosBarras = [0, 0, 0, 0];

    transacciones.forEach(t => {
        const f = new Date(t.fecha + 'T00:00:00');
        const txMes = f.getMonth();
        const txAnio = f.getFullYear();

        ultimosMeses.forEach((m, idx) => {
            if (txMes === m.mes && txAnio === m.anio) {
                if (t.monto > 0) ingresosBarras[idx] += t.monto;
                else gastosBarras[idx] += Math.abs(t.monto);
            }
        });
    });

    if (chartBarInstance) chartBarInstance.destroy();

    const ctxBar = document.getElementById('chart-bar').getContext('2d');
    chartBarInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: ultimosMeses.map(m => m.nombre),
            datasets: [
                {
                    label: 'Ingresos',
                    data: ingresosBarras,
                    backgroundColor: '#10b981',
                    borderRadius: 4
                },
                {
                    label: 'Gastos',
                    data: gastosBarras,
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 12, color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() } }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() } },
                y: { grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() } }
            }
        }
    });
}

// ==========================================================================
// 6. CONTROLADORES DE RUTA / NAVEGACIÓN
// ==========================================================================

function inicializarNavegacion() {
    const links = document.querySelectorAll('.nav-link, .nav-mobile-item');
    links.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = link.dataset.target || link.getAttribute('data-target');
            if (target) {
                // Si la sesión no está activa y no es la pantalla de setup, redirigir a login
                if (!currentUser && target !== 'setup-view') {
                    mostrarVista('auth');
                    return;
                }
                mostrarVista(target.replace('-view', ''));
            }
        });
    });
    establecerFechaHoy();
}

function mostrarVista(vistaNombre) {
    // Activar sección de la vista correspondiente
    Object.keys(views).forEach(key => {
        if (key === vistaNombre) {
            views[key].classList.add('active');
        } else {
            views[key].classList.remove('active');
        }
    });

    // Sincronizar barra de navegación de escritorio y móvil
    const targetId = `${vistaNombre}-view`;
    const links = document.querySelectorAll('.nav-link, .nav-mobile-item');
    links.forEach(link => {
        const target = link.dataset.target || link.getAttribute('data-target');
        if (target === targetId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}
