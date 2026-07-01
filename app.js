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
    reports: document.getElementById('reports-view'),
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

    // Registrar / Iniciar Sesión de usuario con PIN
    document.getElementById('auth-form').addEventListener('submit', manejarAutenticacionPIN);
    
    // Configurar teclado numérico visual de PIN
    configurarTecladoPIN();

    // Botón de cerrar sesión
    document.getElementById('btn-logout').addEventListener('click', cerrarSesion);

    // Filtros interactivos
    document.getElementById('filter-mes').addEventListener('change', renderizarTransaccionesYFiltros);
    document.getElementById('filter-categoria').addEventListener('change', renderizarTransaccionesYFiltros);

    // Eventos de selección de rango en Reportes
    ['dia', 'semana', 'mes'].forEach(rango => {
        document.getElementById(`btn-group-${rango}`).addEventListener('click', (e) => {
            document.querySelectorAll('#reports-view .btn-toggle').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            renderizarReportesAgrupados(rango);
        });
    });
});

// Configuración de los botones del teclado PIN en pantalla y teclado físico
function configurarTecladoPIN() {
    const pinInput = document.getElementById('auth-pin');
    
    // Permitir escribir solo números usando el teclado físico de la PC
    pinInput.addEventListener('keydown', (e) => {
        // Permitir teclas de control como backspace, delete, tab, escape, enter, flechas
        const controlKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight'];
        if (controlKeys.includes(e.key)) {
            return;
        }
        // Bloquear si no es un número o si ya llegó al límite de 12 caracteres
        if (!/^[0-9]$/.test(e.key) || pinInput.value.length >= 12) {
            e.preventDefault();
        }
    });

    document.querySelectorAll('.btn-pin').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.val;
            if (val === 'clear') {
                pinInput.value = '';
            } else if (val === 'back') {
                pinInput.value = pinInput.value.slice(0, -1);
            } else {
                if (pinInput.value.length < 12) {
                    pinInput.value += val;
                }
            }
        });
    });
}

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
// 2. SISTEMA DE AUTENTICACIÓN POR PIN
// ==========================================================================

async function manejarAutenticacionPIN(e) {
    e.preventDefault();
    if (!supabaseClient) return;

    const pin = document.getElementById('auth-pin').value;
    if (!pin) {
        alert('Por favor ingresa tu PIN.');
        return;
    }

    try {
        // Para sincronizar PC y Celular sin usar correos electrónicos ni gatillar el rate limit,
        // utilizaremos un sistema de inicio de sesión anónimo en Supabase.
        // Iniciamos sesión de manera anónima
        const { data, error } = await supabaseClient.auth.signInAnonymously();

        if (error) throw error;

        // Guardamos el PIN ingresado localmente como identificador para filtrar los datos.
        // Aunque la sesión de Supabase sea anónima, asociaremos las transacciones
        // a este PIN específico en la base de datos para que si cambias de PIN o dispositivo,
        // se acceda a la base de datos correcta.
        currentUser = data.user;
        
        // Guardamos el PIN en LocalStorage para identificar los datos del usuario actual
        localStorage.setItem('user_pin', pin);

        document.getElementById('btn-logout').style.display = 'block';
        mostrarVista('dashboard');
        await cargarDatos();
    } catch (error) {
        alert('Error en acceso por PIN: ' + error.message);
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

    const pin = localStorage.getItem('user_pin');
    if (!pin) return;

    try {
        // Cargar Transacciones filtradas por el PIN
        let { data: txData, error: txError } = await supabaseClient
            .from('transacciones')
            .select('*')
            .eq('pin', pin)
            .order('fecha', { ascending: false });

        if (txError) throw txError;
        transacciones = txData || [];

        // Cargar Presupuestos filtrados por el PIN
        let { data: bData, error: bError } = await supabaseClient
            .from('presupuestos')
            .select('*')
            .eq('pin', pin);

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
        renderizarReportesAgrupados('dia');
        actualizarProgresoPresupuestos();
        renderizarGraficos();
    } catch (error) {
        console.error('Error al cargar datos de Supabase:', error.message);
    }
}

async function guardarTransaccion(e) {
    e.preventDefault();
    if (!supabaseClient || !currentUser) return;

    const pin = localStorage.getItem('user_pin');
    if (!pin) return;

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
                pin,
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

    const pin = localStorage.getItem('user_pin');
    if (!pin) return;

    const categoria = document.getElementById('budget-categoria').value;
    const monto_limite = parseFloat(document.getElementById('budget-monto').value);

    try {
        // Comprobar si ya existe presupuesto para esa categoría para este PIN
        const existe = presupuestos.find(b => b.categoria === categoria && b.pin === pin);
        
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
                .insert([{ user_id: currentUser.id, pin, categoria, monto_limite }]);
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

// Obtiene el rango del período actual: desde el último sueldo registrado hasta hoy
function obtenerPeriodoActual() {
    const hoy = new Date();
    
    // Buscar la transacción más reciente de tipo "ingreso" y categoría "Sueldo"
    const ultimoSueldo = transacciones
        .filter(t => t.monto > 0 && t.categoria === 'Sueldo')
        .sort((a, b) => new Date(b.fecha + 'T00:00:00') - new Date(a.fecha + 'T00:00:00'))[0];

    let fechaInicio;
    if (ultimoSueldo) {
        fechaInicio = new Date(ultimoSueldo.fecha + 'T00:00:00');
    } else {
        // Por defecto, si no hay sueldo, inicia el 1 del mes en curso
        fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    }
    
    return {
        inicio: fechaInicio,
        fin: hoy,
        tieneSueldo: !!ultimoSueldo
    };
}

// Filtra las transacciones del período en curso para los indicadores superiores
function actualizarResumenFinanciero() {
    const periodo = obtenerPeriodoActual();

    // Transacciones que entran en el rango dinámico del período actual
    const transaccionesPeriodo = transacciones.filter(t => {
        const f = new Date(t.fecha + 'T00:00:00');
        // Quitar horas para comparar solo fechas completas
        const fCompare = new Date(f.getFullYear(), f.getMonth(), f.getDate());
        const iCompare = new Date(periodo.inicio.getFullYear(), periodo.inicio.getMonth(), periodo.inicio.getDate());
        const fiCompare = new Date(periodo.fin.getFullYear(), periodo.fin.getMonth(), periodo.fin.getDate());
        
        return fCompare >= iCompare && fCompare <= fiCompare;
    });

    let ingresos = 0;
    let gastos = 0;

    transaccionesPeriodo.forEach(t => {
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

    // Mostrar badge informativo sobre el período
    const formattedInicio = periodo.inicio.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
    const headerTitle = document.querySelector('#dashboard-view h3');
    if (headerTitle) {
        headerTitle.innerHTML = `Análisis de Gastos e Ingresos <span style="font-size: 0.85rem; font-weight: normal; color: var(--text-muted); background: var(--bg-tertiary); padding: 4px 10px; border-radius: 20px; margin-left: 8px;">Período: ${formattedInicio} - Hoy ${periodo.tieneSueldo ? '(Desde último Sueldo)' : ''}</span>`;
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

        const sign = t.monto > 0 ? '+' : '-';

        item.innerHTML = `
            <div class="tx-info">
                <h4>${t.categoria}</h4>
                <span>${fechaFormateada} • ${t.metodo_pago} ${t.descripcion ? `• ${t.descripcion}` : ''}</span>
            </div>
            <div class="tx-amount-area">
                <span class="tx-amount ${t.tipo}">${sign}$${Math.abs(t.monto).toFixed(2)}</span>
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

// Progreso mensual vs presupuestos límites establecidos (basado en el período dinámico)
function actualizarProgresoPresupuestos() {
    const container = document.getElementById('budget-progress-container');
    container.innerHTML = '';

    if (presupuestos.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">Establece límites mensuales en el panel izquierdo.</div>`;
        return;
    }

    const periodo = obtenerPeriodoActual();

    presupuestos.forEach(b => {
        // Calcular gasto dentro de este período dinámico
        const gastado = transacciones
            .filter(t => {
                const f = new Date(t.fecha + 'T00:00:00');
                const fCompare = new Date(f.getFullYear(), f.getMonth(), f.getDate());
                const iCompare = new Date(periodo.inicio.getFullYear(), periodo.inicio.getMonth(), periodo.inicio.getDate());
                const fiCompare = new Date(periodo.fin.getFullYear(), periodo.fin.getMonth(), periodo.fin.getDate());

                return t.tipo === 'gasto' && 
                       t.categoria === b.categoria && 
                       fCompare >= iCompare && 
                       fCompare <= fiCompare;
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
    const periodo = obtenerPeriodoActual();

    // 1. Datos para gráfico de Torta (Distribución de Gastos en el período actual)
    const gastosPorCat = {};
    CATEGORIAS_GASTOS.forEach(cat => gastosPorCat[cat] = 0);

    transacciones.forEach(t => {
        const f = new Date(t.fecha + 'T00:00:00');
        const fCompare = new Date(f.getFullYear(), f.getMonth(), f.getDate());
        const iCompare = new Date(periodo.inicio.getFullYear(), periodo.inicio.getMonth(), periodo.inicio.getDate());
        const fiCompare = new Date(periodo.fin.getFullYear(), periodo.fin.getMonth(), periodo.fin.getDate());

        if (t.tipo === 'gasto' && fCompare >= iCompare && fCompare <= fiCompare) {
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
        ctxPie.clearRect(0, 0, 300, 300);
    }

    // 2. Datos para gráfico de Barras (Historial de los últimos 4 períodos equivalentes en meses)
    const hoy = new Date();
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

    // Cargar reportes si entra a la vista de reportes
    if (vistaNombre === 'reports') {
        const activeRange = document.querySelector('#reports-view .btn-toggle.active').id.replace('btn-group-', '');
        renderizarReportesAgrupados(activeRange);
    }
}

// ==========================================================================
// 7. LÓGICA DE REPORTES AGRUPADOS (ACORDEÓN)
// ==========================================================================

function renderizarReportesAgrupados(rango = 'dia') {
    const container = document.getElementById('reports-list-container');
    container.innerHTML = '';

    if (transacciones.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No hay transacciones registradas para agrupar.</div>`;
        return;
    }

    const grupos = {};

    transacciones.forEach(t => {
        const dateObj = new Date(t.fecha + 'T00:00:00');
        let claveGrupo = '';
        let labelGrupo = '';

        if (rango === 'dia') {
            claveGrupo = t.fecha;
            labelGrupo = dateObj.toLocaleDateString('es-ES', {
                weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
            });
            // Capitalizar primer letra del dia
            labelGrupo = labelGrupo.charAt(0).toUpperCase() + labelGrupo.slice(1);
        } else if (rango === 'semana') {
            // Obtener rango de lunes a domingo para esa fecha
            const primerDiaSemana = new Date(dateObj);
            const diaSemana = dateObj.getDay(); // 0: Dom, 1: Lun...
            const dif = dateObj.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1); // Ajustar a Lunes
            primerDiaSemana.setDate(dif);
            
            const ultimoDiaSemana = new Date(primerDiaSemana);
            ultimoDiaSemana.setDate(primerDiaSemana.getDate() + 6);

            const format = { day: '2-digit', month: 'short' };
            claveGrupo = `${primerDiaSemana.toISOString().split('T')[0]}_semana`;
            labelGrupo = `Semana: ${primerDiaSemana.toLocaleDateString('es-ES', format)} - ${ultimoDiaSemana.toLocaleDateString('es-ES', format)}`;
        } else if (rango === 'mes') {
            const anio = dateObj.getFullYear();
            const mes = dateObj.getMonth();
            claveGrupo = `${anio}-${mes}`;
            const nombreMes = dateObj.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
            labelGrupo = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);
        }

        if (!grupos[claveGrupo]) {
            grupos[claveGrupo] = {
                label: labelGrupo,
                ingresos: 0,
                gastos: 0,
                transacciones: []
            };
        }

        if (t.monto > 0) {
            grupos[claveGrupo].ingresos += t.monto;
        } else {
            grupos[claveGrupo].gastos += Math.abs(t.monto);
        }
        grupos[claveGrupo].transacciones.push(t);
    });

    // Ordenar los grupos cronológicamente descendente
    const clavesOrdenadas = Object.keys(grupos).sort((a, b) => b.localeCompare(a));

    clavesOrdenadas.forEach(clave => {
        const g = grupos[clave];
        const balanceNeto = g.ingresos - g.gastos;
        const netoClase = balanceNeto >= 0 ? 'positivo' : 'negativo';
        const netoSigno = balanceNeto >= 0 ? '+' : '-';

        const card = document.createElement('div');
        card.className = 'report-group-card';
        
        card.innerHTML = `
            <div class="report-group-header">
                <span class="report-group-title">${g.label}</span>
                <div class="report-group-summary">
                    <span class="report-summary-badge ingreso">+$${g.ingresos.toFixed(2)}</span>
                    <span class="report-summary-badge gasto">-$${g.gastos.toFixed(2)}</span>
                    <span class="report-summary-badge neto ${netoClase}">${netoSigno}$${Math.abs(balanceNeto).toFixed(2)}</span>
                    <span class="report-group-icon">▼</span>
                </div>
            </div>
            <div class="report-group-details">
                <!-- Listado interno de transacciones del grupo -->
                <div style="display: flex; flex-direction: column;">
                    ${g.transacciones.map(t => {
                        const sign = t.monto > 0 ? '+' : '-';
                        const tClass = t.monto > 0 ? 'ingreso' : 'gasto';
                        const fechaT = new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
                        return `
                            <div class="report-detail-item">
                                <div class="report-detail-info">
                                    <h5>${t.categoria}</h5>
                                    <span>${fechaT} • ${t.metodo_pago} ${t.descripcion ? `• ${t.descripcion}` : ''}</span>
                                </div>
                                <span class="report-detail-amount ${tClass}">${sign}$${Math.abs(t.monto).toFixed(2)}</span>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // Asignar toggle para abrir/cerrar el acordeón
        card.querySelector('.report-group-header').addEventListener('click', () => {
            card.classList.toggle('open');
        });

        container.appendChild(card);
    });
}

