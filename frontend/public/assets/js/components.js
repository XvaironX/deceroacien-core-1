/**
 * SISTEMA DE COMPONENTES JAVASCRIPT ORIENTADO A OBJETOS
 * 
 * Este archivo implementa un sistema completo de componentes reutilizables
 * siguiendo los principios de Programación Orientada a Objetos (POO):
 * 
 * PATRONES IMPLEMENTADOS:
 * - Factory Pattern: Para crear instancias de componentes
 * - Observer Pattern: Para manejo de eventos
 * - Singleton Pattern: Para el gestor principal de la aplicación
 * - Strategy Pattern: Para diferentes tipos de componentes
 * 
 * ARQUITECTURA:
 * 1. BaseComponent: Clase abstracta base con funcionalidad común
 * 2. Componentes especializados: HeaderComponent, FooterComponent, CardComponent
 * 3. AppManager: Controlador principal que orquesta todos los componentes
 * 4. Utilidades: Funciones helper y configuración global
 */

/**
 * Utilidades y configuración global
 */
const GlobalConfig = {
    basePath: '', // Prefijo para rutas relativas ("", "../", "../../", etc.)
    assetVersion: '20251014' // Versión simple para cache busting de JS/CSS inyectados
};

// Shim defensivo para entitlements antiguos en caché: evita ReferenceError si llaman grantFromURLParams antes de definirla
if (typeof window !== 'undefined') {
    if (typeof window.grantFromURLParams !== 'function') {
        window.grantFromURLParams = function(){ /* noop shim to avoid errors from cached entitlements.js */ };
    }
}

/**
 * Detecta el basePath a partir del src del script que carga este archivo.
 * Permite que las rutas del header/footer funcionen desde subcarpetas.
 */
function detectBasePath() {
    try {
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            const src = scripts[i].getAttribute('src') || '';
            // Buscar el script de components.js en cualquier nivel
            if (/assets\/js\/components\.js$/.test(src)) {
                // Extraer la parte previa a "assets/js/components.js"
                const withoutFile = src.replace(/assets\/js\/components\.js$/, '');
                GlobalConfig.basePath = withoutFile || '';
                break;
            }
        }
    } catch (e) {
        console.warn('No se pudo detectar basePath automáticamente, usando ""');
        GlobalConfig.basePath = '';
    }
}

// Detectar basePath lo antes posible
if (typeof document !== 'undefined') {
    detectBasePath();
    // Inyectar estilos globales
    ensureGlobalStyles(); // mantener orden de estilos
}

/**
 * Inyecta estilos globales si no están presentes (common.css y mobile.css)
 */
function ensureGlobalStyles() {
    try {
        const head = document.head || document.getElementsByTagName('head')[0];
        const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map(l => l.getAttribute('href') || '');

        const styles = [
            // Asegurar Tailwind primero si no está presente (fallback)
            `${GlobalConfig.basePath}assets/styles/tailwind.css`,
            `${GlobalConfig.basePath}assets/styles/common.css`,
            `${GlobalConfig.basePath}assets/styles/mobile.css`
        ];

        styles.forEach(href => {
            const already = existing.some(e => e.endsWith(href.replace(GlobalConfig.basePath, '')) || e === href);
            if (!already) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                // Si estamos insertando tailwind.css y ya existe common.css, insertarlo antes para mantener el orden correcto
                const isTailwind = /assets\/styles\/tailwind\.css$/.test(href);
                if (isTailwind) {
                    const commonLink = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
                        .find(l => {
                            const h = l.getAttribute('href') || '';
                            return /assets\/styles\/common\.css$/.test(h) || h.endsWith('assets/styles/common.css');
                        });
                    if (commonLink && commonLink.parentNode) {
                        commonLink.parentNode.insertBefore(link, commonLink);
                        return;
                    }
                }
                head.appendChild(link);
            }
        });

        // Inyectar Font Awesome 6 solo si no hay ninguna versión ya presente
    const hasAnyFA = existing.some(e => /font-awesome|fontawesome|\/all\.min\.css/.test(e));
        if (!hasAnyFA) {
            const fa6 = document.createElement('link');
            fa6.rel = 'stylesheet';
            fa6.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            head.appendChild(fa6);
        }
    } catch (e) {
        console.warn('No se pudieron inyectar estilos globales:', e);
    }
}

/**
 * Crea placeholders de header/footer si no existen en el DOM
 */
function ensureHeaderFooterPlaceholders() {
    const body = document.body;
    if (!document.querySelector('.header-component')) {
        const header = document.createElement('header');
        header.className = 'header-component';
        body.insertAdjacentElement('afterbegin', header);
    }
    if (!document.querySelector('.footer-component')) {
        const footer = document.createElement('footer');
        footer.className = 'footer-component';
        body.insertAdjacentElement('beforeend', footer);
    }
}

/**
 * CLASE BASE ABSTRACTA - BaseComponent
 * 
 * Actúa como clase padre para todos los componentes del sistema.
 * Implementa el patrón Template Method para definir el ciclo de vida
 * común de todos los componentes.
 * 
 * RESPONSABILIDADES:
 * - Gestión del ciclo de vida (init, destroy)
 * - Manejo básico de eventos
 * - Validación de estado
 * - Logging básico para debugging
 */
class BaseComponent {
    /**
     * Constructor de la clase base
     * @param {HTMLElement} element - Elemento DOM asociado al componente
     */
    constructor(element) {
        this.element = element;
        this.isInitialized = false;
        this.eventListeners = new Map(); // Registro de eventos para limpieza
    }

    /**
     * Método template para inicializar el componente
     * Define el flujo estándar de inicialización que siguen todos los componentes
     * 
     * PATRÓN: Template Method
     * FLUJO: Validación → Marcado como inicializado → Eventos → Log
     */
    init() {
        if (this.isInitialized) {
            console.warn(`Componente ${this.constructor.name} ya inicializado`);
            return;
        }
        
        this.isInitialized = true;
        this.bindEvents();
        this.logInitialization();
    }

    /**
     * Método virtual para vincular eventos específicos del componente
     * Las clases hijas deben sobrescribir este método si necesitan eventos
     * 
     * PATRÓN: Template Method (Hook Method)
     */
    bindEvents() {
        // Implementación por defecto vacía
        // Las clases derivadas pueden sobrescribir este método
    }

    /**
     * Log de inicialización para debugging y monitoreo
     * Ayuda en el desarrollo y troubleshooting
     */
    logInitialization() {
        console.log(`✅ ${this.constructor.name} inicializado correctamente`);
    }

    /**
     * Método para registrar event listeners con cleanup automático
     * Evita memory leaks registrando todos los eventos para limpieza posterior
     * 
     * @param {string} event - Tipo de evento
     * @param {Function} handler - Función manejadora
     * @param {Object} options - Opciones del event listener
     */
    addEventListener(event, handler, options = {}) {
        if (this.element) {
            this.element.addEventListener(event, handler, options);
            // Registrar para cleanup posterior
            this.eventListeners.set(event, { handler, options });
        }
    }

    /**
     * Método para destruir el componente y limpiar recursos
     * Implementa cleanup automático para evitar memory leaks
     * 
     * PATRÓN: Destructor simulado en JavaScript
     */
    destroy() {
        if (!this.isInitialized) return;

        // Limpiar todos los event listeners registrados
        this.eventListeners.forEach(({ handler }, event) => {
            if (this.element) {
                this.element.removeEventListener(event, handler);
            }
        });
        
        this.eventListeners.clear();
        this.isInitialized = false;
        
        // Solo log en debug mode para evitar spam en consola
        if (window.DEBUG_MODE) {
            console.log(`🗑️ ${this.constructor.name} destruido y limpiado`);
        }
    }
}

/**
 * CLASE ESPECIALIZADA - HeaderComponent
 * 
 * Extiende BaseComponent para manejar específicamente la navegación del sitio.
 * Implementa funcionalidades avanzadas como:
 * - Detección automática de página activa
 * - Menú móvil responsivo
 * - Gestión de estado de navegación
 * 
 * PATRONES IMPLEMENTADOS:
 * - State Pattern: Para el estado del menú móvil (abierto/cerrado)
 * - Observer Pattern: Para reaccionar a cambios de URL
 * - Factory Pattern: Para crear elementos del menú móvil dinámicamente
 */
class HeaderComponent extends BaseComponent {
    /**
     * Constructor del componente Header
     * Inicializa propiedades específicas del header
     */
    constructor(element) {
        super(element);
        this.mobileMenuButton = null;
        this.mobileMenu = null;
        this.isMenuOpen = false; // Estado del menú móvil
        this.currentPage = this.getCurrentPage(); // Detección automática de página
        this.breakpoint = 768; // Punto de quiebre para diseño responsivo
        this.basePath = GlobalConfig.basePath || '';
    }

    /**
     * Determina la página actual basada en la URL del navegador
     * Utiliza el pathname para extraer el nombre del archivo actual
     * 
     * @returns {string} Nombre de la página actual sin extensión
     * 
     * EJEMPLOS:
     * - "/index.html" → "index"
     * - "/nosotros.html" → "nosotros"
     * - "/" → "index" (página por defecto)
     */
    getCurrentPage() {
        const path = window.location.pathname || '';
        const filename = path.split('/').pop() || 'index.html';

        const p = path.toLowerCase();
        // Academy: cualquier ruta dentro de /academy-fases/ activa 'academy'
        if (p.includes('/academy-fases/')) return 'academy';
        // Comunidad: activar cuando estamos en rutas /comunidad/ pero no afiliados
        if (p.includes('/comunidad/') && !p.includes('/afiliados')) return 'comunidad';
        // Afiliados: detectar específicamente la página de afiliados
        if (p.includes('/comunidad/afiliados')) return 'afiliados';
    // Talento
    if (p.includes('/talento/')) return 'talent';
    // Liderazgo
    if (p.includes('/liderazgo/')) return 'liderazgo';
        // Nuevas secciones del header
        if (p.includes('/formacion-semilla-talleres/')) return 'formacion-semilla';
        if (p.endsWith('/de-cero-a-cien.html') || p.endsWith('/de_cero_a_cien.html')) return 'de-cero-a-cien';
        if (p.endsWith('/camino-dorado.html') || p.includes('/camino-dorado-fases/')) return 'camino-dorado';

        // Remover extensión .html y manejar casos comunes
        let pageName = filename.replace('.html', '');

        if (!pageName || pageName === '') {
            pageName = 'index';
        }

        return pageName;
    }

    /**
     * Inicializa el header con todas sus funcionalidades
     * Sobrescribe el método de la clase padre para agregar lógica específica
     * 
     * PATRÓN: Template Method Override
     */
    init() {
        super.init(); // Llamar al método padre
        this.generateHeaderHTML();
        this.createMobileMenu();
        this.applyMobileAuthVisibility();
        this.applyMobileNavVisibility && this.applyMobileNavVisibility();
        this.setupPriorityNav();
        console.log('Header inicializado correctamente con HTML dinámico');
    }

    /**
     * Genera el HTML completo del header
     */
    generateHeaderHTML() {
    const headerHTML = `
            <nav class="header-nav" style="display:flex; align-items:center; gap:16px; padding:12px 20px; width:100%; max-width:100%; box-sizing:border-box;">
                <!-- Logo principal -->
        <a href="${this.basePath}index.html" class="header-logo" aria-label="Inicio DE CERO A CIEN" style="flex:0 0 auto; display:flex; align-items:center; gap:8px;">
            <img src="${this.basePath}assets/logo_de_cero_a_cien_blanco_y_dorado.png" alt="DE CERO A CIEN" class="header-logo-img" loading="lazy" />
                </a>
                
                <!-- Navegación principal (desktop) -->
                <div class="header-nav-links" style="flex:1 1 auto; display:flex; flex-wrap:nowrap; align-items:center; gap:12px; overflow:hidden; min-width:0;">
            <a href="${this.basePath}index.html" data-priority="0" class="header-link ${this.currentPage === 'index' ? 'active' : ''}">Inicio</a>
            <a href="${this.basePath}nosotros.html" data-priority="1" class="header-link ${this.currentPage === 'nosotros' ? 'active' : ''}">Nosotros</a>
            <a href="${this.basePath}de-cero-a-cien.html" data-priority="2" class="header-link ${this.currentPage === 'de-cero-a-cien' ? 'active' : ''}">De Cero a Cien</a>
                </div>

                <!-- Menú overflow "Más" (desktop) -->
                <div class="header-more" style="position:relative; display:none; margin-left:8px; flex:0 0 auto;">
                    <button class="header-more-btn" aria-haspopup="true" aria-expanded="false" aria-label="Más enlaces"
                        style="background:transparent; color:inherit; border:1px solid rgba(255,255,255,0.2); padding:6px 10px; border-radius:9999px; cursor:pointer;">
                        Más ▾
                    </button>
                    <div class="header-more-menu" role="menu"
                        style="position:absolute; right:0; top:calc(100% + 6px); background:rgba(2,6,23,0.98); border:1px solid rgba(255,255,255,0.15); border-radius:10px; min-width:200px; padding:6px; display:none; z-index:50; box-shadow:0 10px 25px rgba(0,0,0,0.3);">
                    </div>
                </div>
                
                <!-- Sección de autenticación -->
                <div class="header-auth-section" id="headerAuthSection" style="flex:0 0 auto; display:flex; align-items:center; gap:10px;">
                    <a href="${this.basePath}auth/login.html" class="header-login-link">Ingresar</a>
                    <a href="${this.basePath}auth/register.html" class="header-register-btn">Registrarse</a>
                </div>
            </nav>
        `;

        this.element.innerHTML = headerHTML;
        
        // Verificar estado de autenticación después de generar el HTML
        // Usar múltiples intentos para asegurar que authManager esté disponible
        this.scheduleAuthCheck();
    }
    
    /**
     * Programa verificaciones del estado de autenticación
     */
    scheduleAuthCheck() {
        // Verificaciones múltiples para asegurar que authManager esté disponible
        const checkTimes = [100, 500, 1000, 2000];
        
        checkTimes.forEach(delay => {
            setTimeout(() => this.updateAuthSection(), delay);
        });
        
        // También verificar cuando se cargue completamente la página
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => this.updateAuthSection(), 100);
            });
        }
        // Escuchar cambios de preferencia de avatar entre pestañas y refrescar header
        window.addEventListener('storage', (e) => {
            if (e.key === 'deceroacien_avatar_pref' || e.key === 'deceroacien_user') {
                setTimeout(() => this.updateAuthSection(), 50);
                if (typeof this.updateMobileAuthInMenu === 'function') this.updateMobileAuthInMenu();
            }
        });
    }
    
    /**
     * Actualiza la sección de autenticación según el estado del usuario
     */
    updateAuthSection() {
        const authSection = document.getElementById('headerAuthSection');
        if (!authSection) return;
        
        // Verificar si el usuario está autenticado
        if (window.authManager && window.authManager.isUserAuthenticated()) {
            const user = window.authManager.getCurrentUser();
            const firstName = user.firstName || 'Usuario';
            const pref = (localStorage.getItem('deceroacien_avatar_pref') || 'male').toLowerCase();
            let avatar = (user && user.profilePicture) ? user.profilePicture : (pref === 'female' ? '/assets/female-avatar.png' : '/assets/male-avatar.png');
            authSection.innerHTML = `
                <div class="header-user-menu" style="position:relative;display:flex;align-items:center;gap:8px;">
                    <button class="header-user-toggle" aria-haspopup="true" aria-expanded="false" style="display:flex;align-items:center;gap:8px;background:none;border:none;color:#e6f1ff;cursor:pointer;padding:4px 6px;border-radius:8px;">
                        <img src="${avatar}" alt="Avatar" style="width:28px;height:28px;border-radius:9999px;border:2px solid #FBBF24;object-fit:cover;"/>
                        <span class="header-user-greeting" style="color:#e6f1ff;">Hola, ${firstName}</span>
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M5 7l5 5 5-5" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <div class="header-user-dropdown" role="menu" style="display:none;position:absolute;right:0;top:calc(100% + 8px);background:#0b1220;border:1px solid #1e2d4d;border-radius:10px;min-width:220px;box-shadow:0 10px 25px rgba(0,0,0,0.35);overflow:hidden;z-index:9999;">
                        <a href="${this.basePath}auth/dashboard.html" role="menuitem" style="display:block;padding:10px 12px;color:#e6f1ff;text-decoration:none;">Dashboard</a>
                        <a href="${this.basePath}portal-alumno.html" role="menuitem" style="display:block;padding:10px 12px;color:#e6f1ff;text-decoration:none;">Portal del Alumno</a>
                        <div class="hdr-admin-links" style="display:none">
                          <div style="height:1px;background:#1e2d4d;margin:4px 0;"></div>
                          <div class="hdr-admin-block"></div>
                        </div>
                        <div style="height:1px;background:#1e2d4d;margin:4px 0;"></div>
                        <button role="menuitem" data-logout style="width:100%;text-align:left;padding:10px 12px;background:none;border:none;color:#fca5a5;cursor:pointer;">Cerrar Sesión</button>
                    </div>
                </div>
            `;
            // Comportamiento del dropdown
            const container = authSection.querySelector('.header-user-menu');
            const toggleBtn = container.querySelector('.header-user-toggle');
            const dropdown = container.querySelector('.header-user-dropdown');
            const setOpen = (open)=>{
                dropdown.style.display = open ? 'block' : 'none';
                toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
                container.classList.toggle('open', open);
            };
            if (toggleBtn) {
                toggleBtn.addEventListener('click', (e)=>{ e.preventDefault(); setOpen(!container.classList.contains('open')); });
            }
            // Cierre al hacer click fuera
            if (!this._dropdownOutsideHandler) {
                this._dropdownOutsideHandler = (ev)=>{ try { if (container && !container.contains(ev.target)) setOpen(false); } catch(_){} };
                document.addEventListener('click', this._dropdownOutsideHandler);
                this._dropdownEscHandler = (ev)=>{ if (ev.key === 'Escape') setOpen(false); };
                document.addEventListener('keydown', this._dropdownEscHandler);
            }
            // Logout en el dropdown
            const logoutBtn = authSection.querySelector('[data-logout]');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try { if (window.authManager && typeof window.authManager.logout === 'function') await window.authManager.logout(); } catch(_){}
                });
            }

            // Cargar scopes y agregar accesos a paneles (admin/profesor/superadmin/empresa)
            (async () => {
                try {
                    const token = localStorage.getItem('deceroacien_token');
                    const headers = { 'Accept':'application/json' };
                    if (token) headers['Authorization'] = 'Bearer ' + token;
                    const resp = await fetch('/api/auth/me', { headers });
                    if (!resp.ok) return;
                    const me = await resp.json();
                    const scopes = (me && me.scopes) || [];
                    const linksWrap = authSection.querySelector('.hdr-admin-links');
                    const block = authSection.querySelector('.hdr-admin-block');
                    if (!linksWrap || !block) return;
                    const has = (p) => scopes.includes('*') || scopes.some(s => s === p || s.startsWith(p));
                    const items = [];
                    if (has('admin:')) items.push({ href: this.basePath + 'admin/index.html', label: 'Panel Administración' });
                    if (has('calendar:manage') || has('courses:read')) items.push({ href: this.basePath + 'admin/profesor.html', label: 'Panel Profesor' });
                    if (scopes.includes('*')) items.push({ href: this.basePath + 'admin/superadmin.html', label: 'Panel SuperAdmin' });
                    if (has('tenant:manage-users') || has('reports:read:tenant')) items.push({ href: this.basePath + 'admin/empresa.html', label: 'Panel Empresa' });
                    if (items.length) {
                        linksWrap.style.display = 'block';
                        block.innerHTML = items.map(i => `<a href="${i.href}" role="menuitem" style="display:block;padding:10px 12px;color:#e6f1ff;text-decoration:none;">${i.label}</a>`).join('');
                    }
                } catch(_){ /* silencioso */ }
            })();
        }

        // Recalcular distribución del menú tras cambios de ancho
        this.reflowPriorityNav && this.reflowPriorityNav();
        // Refrescar auth en menú móvil
        if (typeof this.updateMobileAuthInMenu === 'function') {
            this.updateMobileAuthInMenu();
        }
    }

    /**
     * Crea el menú móvil si no existe
     */
    createMobileMenu() {
        // Solo crear si estamos en viewport móvil
        if (window.innerWidth >= this.breakpoint) return;
        // Si ya existen referencias válidas no recreamos
        if (this.mobileMenuButton && this.mobileMenu) return;

        const nav = this.element.querySelector('.header-nav');
        if (!nav) return;

        const mobileButton = document.createElement('button');
        mobileButton.className = 'mobile-menu-button mobile-only';
        mobileButton.innerHTML = `
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
        `;
        mobileButton.setAttribute('aria-label', 'Abrir menú de navegación');

        const mobileMenu = document.createElement('div');
        mobileMenu.className = 'mobile-menu';
        mobileMenu.innerHTML = this.getMobileMenuHTML();

        nav.appendChild(mobileButton);
        nav.appendChild(mobileMenu);

        this.mobileMenuButton = mobileButton;
        this.mobileMenu = mobileMenu;

        // Vincular evento de toggle inmediatamente (si bindEvents ya corrió)
        this.mobileMenuButton.addEventListener('click', () => this.toggleMobileMenu());
        // Sincronizar estado de auth dentro del menú móvil
        if (typeof this.updateMobileAuthInMenu === 'function') {
            this.updateMobileAuthInMenu();
        }
    }

    /**
     * Genera el HTML del menú móvil
     * @returns {string} HTML del menú móvil
     */
    getMobileMenuHTML() {
    return `
            <div class="mobile-menu-content">
        <a href="${this.basePath}index.html" class="mobile-menu-link">Inicio</a>
        <a href="${this.basePath}nosotros.html" class="mobile-menu-link">Nosotros</a>
        <a href="${this.basePath}de-cero-a-cien.html" class="mobile-menu-link">De Cero a Cien</a>
        <a href="${this.basePath}contacto.html" class="mobile-menu-link">Contacto</a>
                <div class="mobile-menu-auth">
                    <a href="#" class="mobile-auth-link">Ingresa</a>
                    <a href="#" class="mobile-register-btn">Regístrate</a>
                </div>
               <div class="mobile-menu-social" style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
                 <a href="https://www.instagram.com/deceroacien.app/" class="mobile-social-link social-pill social-40" target="_blank" rel="noopener noreferrer" aria-label="Instagram" title="Instagram">
                     <i class="fa-brands fa-instagram" aria-hidden="true"></i>
                 </a>
                 <a href="https://www.linkedin.com/company/de-cero-a-cien-app/?viewAsMember=true" class="mobile-social-link social-pill social-40" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn" title="LinkedIn">
                     <i class="fa-brands fa-linkedin" aria-hidden="true"></i>
                 </a>
                 <a href="https://www.facebook.com/profile.php?id=61580145107768&locale=es_LA" class="mobile-social-link social-pill social-40" target="_blank" rel="noopener noreferrer" aria-label="Facebook" title="Facebook">
                     <i class="fa-brands fa-facebook" aria-hidden="true"></i>
                 </a>
                </div>
            </div>
        `;
    }

    /**
     * Vincula eventos del header
     */
    bindEvents() {
        // Resize handler para crear / eliminar menú móvil dinámicamente
        window.addEventListener('resize', () => this.handleResize());

        // Delegación segura (puede no existir aún al inicio)
        document.addEventListener('click', (e) => {
            if (this.isMenuOpen && this.mobileMenu && this.mobileMenuButton) {
                if (!this.mobileMenu.contains(e.target) && !this.mobileMenuButton.contains(e.target)) {
                    this.closeMobileMenu();
                }
            }

            // Cerrar menú "Más" si se hace click fuera
            const more = this.element.querySelector('.header-more');
            const menu = this.element.querySelector('.header-more-menu');
            const btn = this.element.querySelector('.header-more-btn');
            if (more && menu && btn) {
                if (!more.contains(e.target)) {
                    menu.style.display = 'none';
                    btn.setAttribute('aria-expanded', 'false');
                }
            }
        });

        this.attachMobileInternalEvents();
    }

    /**
     * Enlaza eventos internos del menú móvil si existe
     */
    attachMobileInternalEvents() {
        if (this.mobileMenu) {
            this.mobileMenu.addEventListener('click', (e) => {
                if (e.target.classList && e.target.classList.contains('mobile-menu-link')) {
                    this.closeMobileMenu();
                }
            });
        }
    }

    /**
     * Maneja cambios de tamaño: crea menú en móvil y lo elimina en desktop
     */
    handleResize() {
        if (window.innerWidth < this.breakpoint) {
            // Crear si no existe
            if (!this.mobileMenuButton || !this.mobileMenu) {
                this.createMobileMenu();
                this.attachMobileInternalEvents();
            }
            this.applyMobileAuthVisibility();
            // Ocultar enlaces de escritorio en móvil y sincronizar auth del menú móvil
            if (typeof this.applyMobileNavVisibility === 'function') {
                this.applyMobileNavVisibility();
            }
            if (typeof this.updateMobileAuthInMenu === 'function') {
                this.updateMobileAuthInMenu();
            }
            // En móvil no usamos "Más"
            const more = this.element.querySelector('.header-more');
            if (more) more.style.display = 'none';
        } else {
            // Eliminar si estamos en desktop
            if (this.mobileMenuButton) {
                this.mobileMenuButton.remove();
                this.mobileMenuButton = null;
            }
            if (this.mobileMenu) {
                this.mobileMenu.remove();
                this.mobileMenu = null;
            }
            this.isMenuOpen = false;
            document.body.style.overflow = '';
            this.applyMobileAuthVisibility();
            // Mostrar enlaces de escritorio nuevamente
            if (typeof this.applyMobileNavVisibility === 'function') {
                this.applyMobileNavVisibility();
            }
            // Reflujo de enlaces para desktop
            this.reflowPriorityNav && this.reflowPriorityNav();
        }
    }

    /**
     * Configura el patrón Priority+ para el menú de navegación (desktop)
     */
    setupPriorityNav() {
        try {
            this.navRoot = this.element.querySelector('.header-nav');
            this.linksContainer = this.element.querySelector('.header-nav-links');
            this.moreContainer = this.element.querySelector('.header-more');
            this.moreBtn = this.element.querySelector('.header-more-btn');
            this.moreMenu = this.element.querySelector('.header-more-menu');

            if (!this.navRoot || !this.linksContainer || !this.moreContainer) return;

            // Array base de ítems (orden original)
            const linkEls = Array.from(this.linksContainer.querySelectorAll('a.header-link'));
            this.navItems = linkEls.map((el, index) => ({
                el,
                index,
                priority: parseInt(el.getAttribute('data-priority') || '2', 10)
            }));

            // Toggle del menú "Más"
            if (this.moreBtn && this.moreMenu) {
                this.moreBtn.addEventListener('click', () => {
                    const isOpen = this.moreMenu.style.display === 'block';
                    this.moreMenu.style.display = isOpen ? 'none' : 'block';
                    this.moreBtn.setAttribute('aria-expanded', String(!isOpen));
                });
            }

            // Ejecutar reflow al cargar y en resize
            const doReflow = () => this.reflowPriorityNav();
            setTimeout(doReflow, 0);
            window.addEventListener('load', doReflow);
            window.addEventListener('resize', () => {
                if (window.innerWidth >= this.breakpoint) doReflow();
            });
        } catch (e) {
            console.warn('PriorityNav no disponible:', e);
        }
    }

    /**
     * Mueve enlaces de baja prioridad a un menú "Más" cuando no hay espacio
     */
    reflowPriorityNav() {
        if (!this.navRoot || !this.linksContainer || !this.moreContainer) return;
        if (window.innerWidth < this.breakpoint) return; // Solo desktop

        // 1) Reset: devolver todos los enlaces a su contenedor en orden original
        this.linksContainer.innerHTML = '';
        const ordered = this.navItems.slice().sort((a, b) => a.index - b.index);
        ordered.forEach(item => this.linksContainer.appendChild(item.el));

        // Limpiar menú "Más"
        if (this.moreMenu) this.moreMenu.innerHTML = '';
        // Mostrar contenedor "Más" invisible para reservar ancho cuando se necesite
        this.moreContainer.style.display = 'inline-flex';
        this.moreMenu.style.display = 'none';
        this.moreBtn.setAttribute('aria-expanded', 'false');
        this.moreContainer.style.visibility = 'hidden';

        // 2) Calcular espacio disponible
        const navWidth = this.navRoot.clientWidth;
        const logo = this.element.querySelector('.header-logo');
        const auth = this.element.querySelector('#headerAuthSection');
        const logoW = logo ? logo.getBoundingClientRect().width : 0;
        const authW = auth ? auth.getBoundingClientRect().width : 0;
        const moreW = this.moreContainer.getBoundingClientRect().width || 64; // aproximado
        const buffer = 24; // margen de seguridad
        let available = navWidth - logoW - authW - buffer;

        // 3) Ancho usado por los enlaces actuales
        const itemsNow = Array.from(this.linksContainer.querySelectorAll('a.header-link'));
        const widths = itemsNow.map(el => el.getBoundingClientRect().width + 12); // sumar gap estimado
        let used = widths.reduce((a, b) => a + b, 0);

        // Si caben todos, ocultar "Más"
        if (used <= available) {
            this.moreContainer.style.display = 'none';
            this.moreContainer.style.visibility = '';
            return;
        }

        // 4) Necesitamos "Más"; incluir su ancho
        available -= moreW;

        // 5) Mover por prioridad: 3 -> 2 -> 1 (0 nunca se mueve)
        const moveByPriority = (prio) => {
            // desde el final hacia el inicio para preservar orden de la izquierda
            for (let i = itemsNow.length - 1; i >= 0; i--) {
                const el = itemsNow[i];
                const item = this.navItems.find(n => n.el === el);
                if (!item) continue;
                if (item.priority !== prio) continue;
                if (used <= available) break;

                // mover a menú Más
                const w = el.getBoundingClientRect().width + 12;
                used -= w;
                // quitar del contenedor principal
                el.remove();
                // añadir al menú Más como clon ligero para estilos de lista
                const clone = el.cloneNode(true);
                clone.classList.add('header-more-link');
                clone.style.display = 'block';
                clone.style.padding = '8px 10px';
                clone.style.borderRadius = '8px';
                clone.addEventListener('click', () => {
                    // Cerrar menú tras click
                    this.moreMenu.style.display = 'none';
                    this.moreBtn.setAttribute('aria-expanded', 'false');
                });
                this.moreMenu.appendChild(clone);
            }
        };

        [3, 2, 1].forEach(moveByPriority);

        // Mostrar contenedor "Más" si hay elementos
        const hasOverflow = this.moreMenu && this.moreMenu.children.length > 0;
        this.moreContainer.style.display = hasOverflow ? 'inline-flex' : 'none';
        this.moreContainer.style.visibility = '';
    }

    /**
     * Fuerza visibilidad correcta de la sección de autenticación:
     * - Oculta en móvil (< breakpoint)
     * - Muestra en desktop
     */
    applyMobileAuthVisibility() {
        const authSection = this.element.querySelector('.header-auth-section');
        if (!authSection) return;
        if (window.innerWidth < this.breakpoint) {
            authSection.style.display = 'none';
        } else {
            authSection.style.display = 'flex';
        }
    }

    /**
     * Oculta la barra de enlaces en móvil y la muestra en desktop
     */
    applyMobileNavVisibility() {
        const links = this.element.querySelector('.header-nav-links');
        if (!links) return;
        if (window.innerWidth < this.breakpoint) {
            links.style.display = 'none';
        } else {
            links.style.display = 'flex';
        }
    }

    /**
     * Actualiza la sección de autenticación dentro del menú móvil
     */
    updateMobileAuthInMenu() {
        if (!this.mobileMenu) return;
        const authBlock = this.mobileMenu.querySelector('.mobile-menu-auth');
        if (!authBlock) return;

        // Usuario autenticado
        if (window.authManager && typeof window.authManager.isUserAuthenticated === 'function' && window.authManager.isUserAuthenticated()) {
            const user = (typeof window.authManager.getCurrentUser === 'function') ? window.authManager.getCurrentUser() : null;
            const firstName = (user && user.firstName) || 'Usuario';
            const pref = (localStorage.getItem('deceroacien_avatar_pref') || 'male').toLowerCase();
            let avatar = (user && user.profilePicture) ? user.profilePicture : (pref === 'female' ? '/assets/female-avatar.png' : '/assets/male-avatar.png');
            authBlock.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; gap:10px;">
                    <img src="${avatar}" alt="Avatar" style="width:40px;height:40px;border-radius:9999px;border:2px solid #FBBF24;object-fit:cover;"/>
                    <span style="color:#94a3b8;">Hola, ${firstName}</span>
                    <a href="${this.basePath}auth/dashboard.html" class="mobile-register-btn" style="text-align:center; text-decoration:none;">Ir al Dashboard</a>
                    <div class="mbl-admin-links" style="display:none; width:100%;"></div>
                    <button class="mobile-auth-link" data-logout style="background:none; border:none; color:#94a3b8; cursor:pointer;">Cerrar Sesión</button>
                </div>
            `;
            const btn = authBlock.querySelector('[data-logout]');
            if (btn) btn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (window.authManager && typeof window.authManager.logout === 'function') {
                    try { await window.authManager.logout(); } catch(_) {}
                }
            });
            // Añadir accesos a paneles en móvil según scopes
            (async () => {
                try {
                    const token = localStorage.getItem('deceroacien_token');
                    const headers = { 'Accept':'application/json' };
                    if (token) headers['Authorization'] = 'Bearer ' + token;
                    const resp = await fetch('/api/auth/me', { headers });
                    if (!resp.ok) return;
                    const me = await resp.json();
                    const scopes = (me && me.scopes) || [];
                    const wrap = authBlock.querySelector('.mbl-admin-links');
                    if (!wrap) return;
                    const has = (p) => scopes.includes('*') || scopes.some(s => s === p || s.startsWith(p));
                    const items = [];
                    if (has('admin:')) items.push({ href: this.basePath + 'admin/index.html', label: 'Panel Administración' });
                    if (has('calendar:manage') || has('courses:read')) items.push({ href: this.basePath + 'admin/profesor.html', label: 'Panel Profesor' });
                    if (scopes.includes('*')) items.push({ href: this.basePath + 'admin/superadmin.html', label: 'Panel SuperAdmin' });
                    if (has('tenant:manage-users') || has('reports:read:tenant')) items.push({ href: this.basePath + 'admin/empresa.html', label: 'Panel Empresa' });
                    if (items.length) {
                        wrap.style.display = 'block';
                        wrap.innerHTML = items.map(i => `<a href="${i.href}" class="mobile-register-btn" style="display:block; text-align:center; text-decoration:none;">${i.label}</a>`).join('');
                    }
                } catch(_){ }
            })();
        } else {
            // Invitado
            authBlock.innerHTML = `
                <a href="${this.basePath}auth/login.html" class="mobile-auth-link">Ingresa</a>
                <a href="${this.basePath}auth/register.html" class="mobile-register-btn">Regístrate</a>
            `;
        }
    }

    /**
     * Alterna la visibilidad del menú móvil
     */
    toggleMobileMenu() {
        this.isMenuOpen ? this.closeMobileMenu() : this.openMobileMenu();
    }

    /**
     * Abre el menú móvil
     */
    openMobileMenu() {
        this.mobileMenu.classList.add('open');
        // Resetear scroll al inicio para mostrar los enlaces superiores
        try {
            this.mobileMenu.scrollTop = 0;
        } catch (e) {}
        this.mobileMenuButton.classList.add('open');
        this.isMenuOpen = true;
        document.body.style.overflow = 'hidden'; // Prevenir scroll
        // Ocultar botón flotante de WhatsApp para evitar solape visual
        const wa = document.getElementById('whatsapp-floating');
        if (wa) wa.style.display = 'none';
    }

    /**
     * Cierra el menú móvil
     */
    closeMobileMenu() {
        this.mobileMenu.classList.remove('open');
        this.mobileMenuButton.classList.remove('open');
        this.isMenuOpen = false;
        document.body.style.overflow = ''; // Restaurar scroll
        // Reaparecer botón de WhatsApp
        const wa = document.getElementById('whatsapp-floating');
        if (wa) wa.style.display = '';
    }
}

/**
 * CLASE ESPECIALIZADA - FooterComponent
 * 
 * Extiende BaseComponent para generar y manejar específicamente el footer del sitio.
 * Genera dinámicamente todo el HTML del footer para mantener consistencia.
 * 
 * CARACTERÍSTICAS:
 * - Generación dinámica de HTML
 * - Enlaces contextuales según la página actual
 * - Estructura responsive
 * - Información de contacto centralizada
 */
class FooterComponent extends BaseComponent {
    constructor(element) {
        super(element);
        this.currentPage = this.getCurrentPage();
        this.currentYear = new Date().getFullYear();
    this.basePath = GlobalConfig.basePath || '';
    }

    /**
     * Determina la página actual para marcar enlaces activos
     */
    getCurrentPage() {
        const path = window.location.pathname || '';
        const filename = path.split('/').pop() || 'index.html';

        // Detección de artículos del blog para activar 'Blog'
        const p = path.toLowerCase();
        // Academy: cualquier ruta dentro de /academy-fases/ activa 'academy'
        if (p.includes('/academy-fases/')) return 'academy';
        // Comunidad: activar cuando estamos en rutas /comunidad/ pero no afiliados
        if (p.includes('/comunidad/') && !p.includes('/afiliados')) return 'comunidad';
        // Afiliados: detectar específicamente la página de afiliados
        if (p.includes('/comunidad/afiliados')) return 'afiliados';
        const isBlogArticle = (
            p.includes('no-te-enamores-de-tu-idea') ||
            p.includes('tu-pmv-no-es-un-producto-barato') ||
            p.includes('tu-producto-ya-existe-y-ahora-que') ||
            p.includes('de-fundador-a-arquitecto-maquina-de-crecimiento') ||
            p.includes('ya-eres-grande-ahora-se-imborrable')
        );
        if (isBlogArticle) return 'blog';

    // Detección: rutas dentro de /gamificacion/
    if (p.includes('/gamificacion/')) return 'gamificacion';
    

        return filename.replace('.html', '') || 'index';
    }

    /**
     * Inicializa el footer generando su HTML dinámicamente
     */
    init() {
        super.init();
        this.generateFooterHTML();
        this.bindEvents();
        console.log('✅ FooterComponent inicializado correctamente');
    }

    /**
     * Genera el HTML completo del footer
     */
    generateFooterHTML() {
    const footerHTML = `
            <div class="footer-container">
                <!-- Grid de secciones del footer -->
                <div class="footer-grid">
                    <!-- Sección: Enlaces Rápidos -->
                    <div class="footer-section">
                        <h3>Enlaces Rápidos</h3>
                        <ul>
                <li><a href="${this.basePath}index.html" class="footer-link ${this.currentPage === 'index' ? 'active' : ''}">Inicio</a></li>
                <li><a href="${this.basePath}nosotros.html" class="footer-link ${this.currentPage === 'nosotros' ? 'active' : ''}">Nosotros</a></li>
                <li><a href="${this.basePath}servicios.html" class="footer-link ${this.currentPage === 'servicios' ? 'active' : ''}">Servicios</a></li>
                <li><a href="${this.basePath}faq.html" class="footer-link ${this.currentPage === 'faq' ? 'active' : ''}">FAQ</a></li>
                        </ul>
                    </div>
                    

                    <!-- Sección: Legal -->
                    <div class="footer-section">
                        <h3>Legal</h3>
                        <ul>
                <li><a href="${this.basePath}legal/terminos.html" class="footer-link ${this.currentPage === 'terminos' ? 'active' : ''}">Términos y Condiciones</a></li>
                <li><a href="${this.basePath}legal/politica-privacidad.html" class="footer-link ${this.currentPage === 'politica-privacidad' ? 'active' : ''}">Política de Privacidad</a></li>
                <li><a href="${this.basePath}legal/politica-cookies.html" class="footer-link ${this.currentPage === 'politica-cookies' ? 'active' : ''}">Política de Cookies</a></li>
                <li><a href="${this.basePath}legal/aviso-legal.html" class="footer-link ${this.currentPage === 'aviso-legal' ? 'active' : ''}">Aviso Legal</a></li>
                        </ul>
                    </div>
                    
                    <!-- Sección: Contacto -->
                    <div class="footer-section">
                        <h3>Contacto</h3>
                        <ul>
                            <li><a href="tel:+56985678296" class="footer-link">+56 985 678 296</a></li>
                <li><a href="mailto:hola@deceroacien.app" class="footer-link">hola@deceroacien.app</a></li>
                <li><a href="https://deceroacien.app" target="_blank" class="footer-link">www.deceroacien.app</a></li>
                <li><a href="${this.basePath}contacto.html" class="footer-link">Formulario de Contacto</a></li>
                        </ul>
                    </div>
                </div>
                
                <!-- Línea inferior con copyright -->
                <div class="footer-bottom">
                    <p class="footer-copyright">© ${this.currentYear} DE CERO A CIEN. Todos los derechos reservados.</p>
                    <div class="footer-social" style="margin-top: 12px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span style="color: #94a3b8; font-size: 0.9rem;">Síguenos:</span>
                        <a href="https://www.instagram.com/deceroacien.app/" class="footer-social-pill social-pill social-36" aria-label="Instagram" title="Instagram">
                            <i class="fa-brands fa-instagram" aria-hidden="true"></i>
                        </a>
                        <a href="https://www.linkedin.com/company/de-cero-a-cien-app/?viewAsMember=true" class="footer-social-pill social-pill social-36" aria-label="LinkedIn" title="LinkedIn">
                            <i class="fa-brands fa-linkedin" aria-hidden="true"></i>
                        </a>
                        <a href="https://www.facebook.com/profile.php?id=61580145107768&locale=es_LA" class="footer-social-pill social-pill social-36" aria-label="Facebook" title="Facebook">
                            <i class="fa-brands fa-facebook" aria-hidden="true"></i>
                        </a>
                    </div>
                </div>
            </div>
        `;

        this.element.innerHTML = footerHTML;
    }

    /**
     * Vincula eventos específicos del footer
     */
    bindEvents() {
        // Manejar enlaces externos
        this.handleExternalLinks();
        
        // Agregar tracking para enlaces del footer si es necesario
        const footerLinks = this.element.querySelectorAll('.footer-link');
        footerLinks.forEach(link => {
            link.addEventListener('click', (event) => {
                // Aquí puedes agregar analytics o tracking
                console.log(`📊 Footer link clicked: ${link.textContent}`);
            });
        });
    }

    /**
     * Maneja enlaces externos para que se abran en nueva pestaña
     */
    handleExternalLinks() {
        const links = this.element.querySelectorAll('a[href^="http"], a[href^="mailto:"], a[href^="tel:"]');
        links.forEach(link => {
            if (link.href.startsWith('http') && !link.href.includes(window.location.hostname)) {
                link.setAttribute('target', '_blank');
                link.setAttribute('rel', 'noopener noreferrer');
            }
        });
    }
}

/**
 * Clase para manejar tarjetas interactivas
 * Proporciona funcionalidad común para todas las tarjetas
 */
class CardComponent extends BaseComponent {
    constructor(element) {
        super(element);
        this.hasSpotlight = element.classList.contains('card-spotlight');
    }

    /**
     * Inicializa la tarjeta
     */
    init() {
        super.init();
        if (this.hasSpotlight) {
            this.initSpotlightEffect();
        }
        console.log('Tarjeta inicializada correctamente');
    }

    /**
     * Inicializa el efecto spotlight
     */
    initSpotlightEffect() {
        this.element.addEventListener('mouseenter', () => {
            this.element.style.setProperty('--spotlight-opacity', '1');
        });

        this.element.addEventListener('mouseleave', () => {
            this.element.style.setProperty('--spotlight-opacity', '0');
        });
    }

    /**
     * Vincula eventos de la tarjeta
     */
    bindEvents() {
        this.element.addEventListener('click', this.handleCardClick.bind(this));
    }

    /**
     * Maneja el clic en la tarjeta
     * @param {Event} event - Evento de clic
     */
    handleCardClick(event) {
        // Buscar si hay un enlace principal en la tarjeta
        const primaryLink = this.element.querySelector('.card-primary-link, .cta-button:not(.cursor-not-allowed)');
        if (primaryLink && !event.target.closest('a, button')) {
            primaryLink.click();
        }
    }
}

/**
 * Componente global para botón flotante de WhatsApp
 * Garantiza presencia única en todo el sitio sin duplicaciones.
 */
class WhatsAppButtonComponent extends BaseComponent {
    constructor() {
        super(document.body); // El body servirá como ancla para insertar el botón
        this.phone = '+56985678296';
        this.id = 'whatsapp-floating';
    }

    init() {
        // Evitar duplicados si ya existe manualmente
        if (document.getElementById(this.id)) {
            console.log('ℹ️ Botón WhatsApp ya presente, no se duplica');
            return;
        }
        this.render();
        this.logInitialization();
    }

    buildURL() {
        const base = 'https://wa.me/';
        const phoneDigits = this.phone.replace(/[^0-9]/g, '');
        const msg = encodeURIComponent('Hola, quisiera más información sobre sus servicios.');
        return `${base}${phoneDigits}?text=${msg}`;
    }

    render() {
        const a = document.createElement('a');
        a.id = this.id;
        a.href = this.buildURL();
        a.target = '_blank';
        a.rel = 'noopener';
        a.ariaLabel = 'Contactar por WhatsApp';
        a.className = 'floating-whatsapp-btn';
        a.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.487 5.235 3.487 8.413 0 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.886-.003 2.011.564 3.935 1.597 5.66l-1.023 3.748 3.826-1.004zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.501-.173 0-.371-.025-.57-.025-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.078 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
            </svg>`;
        document.body.appendChild(a);
    }
}

/**
 * Clase principal para gestionar toda la aplicación
 * Actúa como un controlador principal que inicializa todos los componentes
 */
class AppManager {
    constructor() {
        this.components = new Map();
        this.isInitialized = false;
    }

    /**
     * Inicializa toda la aplicación
     */
    init() {
        if (this.isInitialized) {
            console.warn('App ya inicializada');
            return;
        }

        try {
            // Asegurar estilos y placeholders globales
            ensureGlobalStyles();
            ensureHeaderFooterPlaceholders();
            this.initializeComponents();
            this.setupGlobalEvents();
            
            // Forzar verificación de autenticación después de un breve delay
            this.scheduleAuthCheck();
            
            this.isInitialized = true;
            console.log('Aplicación inicializada correctamente');
        } catch (error) {
            console.error('Error al inicializar la aplicación:', error);
        }
    }

    /**
     * Inicializa todos los componentes de la página
     */
    initializeComponents() {
        this.renderPortalTopbar();

        // Inicializar Header
        const headerElement = document.querySelector('.header-component');
        if (headerElement) {
            const header = new HeaderComponent(headerElement);
            header.init();
            this.components.set('header', header);
        }

        // Inicializar Footer
        const footerElement = document.querySelector('.footer-component');
        if (footerElement) {
            const footer = new FooterComponent(footerElement);
            footer.init();
            this.components.set('footer', footer);
        }

        // Inicializar todas las tarjetas
        const cardElements = document.querySelectorAll('.card-component');
        cardElements.forEach((cardElement, index) => {
            const card = new CardComponent(cardElement);
            card.init();
            this.components.set(`card-${index}`, card);
        });

        // Inicializar botón flotante de WhatsApp global
        const whatsappBtn = new WhatsAppButtonComponent();
        whatsappBtn.init();
        this.components.set('whatsapp', whatsappBtn);
    }

    renderPortalTopbar() {
        const placeholder = document.querySelector('[data-portal-topbar]');
        if (!placeholder || this.portalTopbarInitialized) return;

        this.portalTopbarInitialized = true;
        const base = GlobalConfig.basePath || '';

        const escapeHtml = (value = '') => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const resolveFirstName = () => {
            try {
                if (window.authManager && typeof window.authManager.isUserAuthenticated === 'function' && window.authManager.isUserAuthenticated()) {
                    const user = window.authManager.getCurrentUser();
                    if (user && user.firstName) return user.firstName;
                }
            } catch (_) {}
            try {
                const cached = localStorage.getItem('deceroacien_user');
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && parsed.firstName) return parsed.firstName;
                }
            } catch (_) {}
            return 'Usuario';
        };

        const render = () => {
            const firstName = escapeHtml(resolveFirstName());
            placeholder.innerHTML = `
                <div class="sticky top-0 z-50 bg-[#0a192f]/80 backdrop-blur-lg border-b border-gray-800">
                    <nav class="container mx-auto max-w-7xl px-6 py-3 flex justify-between items-center">
                        <a href="${base}portal-alumno.html" class="text-lg font-bold highlight-text">← Volver al Centro de Formación</a>
                        <span class="text-sm text-slate-300">Bienvenido, ${firstName}</span>
                    </nav>
                </div>
            `;
        };

        render();
        [400, 1200, 2400].forEach(delay => setTimeout(render, delay));
        window.addEventListener('storage', (event) => {
            if (!event || event.key === 'deceroacien_user') {
                setTimeout(render, 50);
            }
        });
    }

    /**
     * Programa verificaciones del estado de autenticación para todos los headers
     */
    scheduleAuthCheck() {
        const header = this.components.get('header');
        if (header && typeof header.updateAuthSection === 'function') {
            // Verificaciones múltiples para asegurar que authManager esté disponible
            setTimeout(() => header.updateAuthSection(), 500);
            setTimeout(() => header.updateAuthSection(), 1500);
        }
    }

    /**
     * Configura eventos globales de la aplicación
     */
    setupGlobalEvents() {
        // Manejar cambios de tamaño de ventana
        window.addEventListener('resize', this.handleResize.bind(this));

        // Solo manejar cierre real de la aplicación, no navegación
        window.addEventListener('unload', this.handleBeforeUnload.bind(this));

    // Cargar entitlements y auth en rutas protegidas, y configurar lazy loading para imágenes
    this.ensureEntitlementsLoader();
    this.ensureAuthLoaderAndGuard && this.ensureAuthLoaderAndGuard();
        this.setupLazyLoading();
    }

    /**
     * Maneja el redimensionamiento de la ventana
     */
    handleResize() {
        // Cerrar menú móvil si está abierto y la pantalla es grande
        const header = this.components.get('header');
        if (header && window.innerWidth >= 768 && header.isMenuOpen) {
            header.closeMobileMenu();
        }
    }

    /**
     * Maneja eventos antes de cerrar/cambiar la página
     */
    handleBeforeUnload(event) {
        // Solo limpiar si realmente se está cerrando la ventana/pestaña
        // No durante navegación normal o recargas
        if (event.type === 'beforeunload') {
            // Solo logs de debug, no destruir componentes durante navegación
            console.log('🔄 Página cambiando, manteniendo componentes...');
            return;
        }
        
        // Limpiar componentes solo en cierre real
        console.log('🗑️ Limpiando componentes al cerrar aplicación...');
        this.components.forEach(component => {
            if (component.destroy) {
                component.destroy();
            }
        });
    }

    /**
     * Configura lazy loading para imágenes
     */
    setupLazyLoading() {
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        observer.unobserve(img);
                    }
                });
            });

            document.querySelectorAll('img[data-src]').forEach(img => {
                imageObserver.observe(img);
            });
        }
    }

    /**
     * Inyecta auth.js automáticamente en rutas protegidas si no está presente
     * y asegura una llamada a requireAuth() cuando esté disponible.
     */
    ensureAuthLoaderAndGuard() {
        try {
            const path = (location && location.pathname || '').toLowerCase();
            // No aplicar guard en Formación Semilla: la página maneja su propio CTA sin redirigir a login
            if (path.includes('/formacion-semilla-talleres/')) return;
            const isProtected = /\/portal-alumno\.html$/.test(path)
                || /\/fase_\d+_ecd\//.test(path)
                || /\/fase_\d+_de0a100\//.test(path)
                || /\/camino-dorado-fases\/fase_\d+_ecd\//.test(path);

            if (!isProtected) return;

            const hasAuth = Array.from(document.scripts).some(s => (s.src || '').includes('assets/js/auth.js'));
            if (!hasAuth) {
                const s = document.createElement('script');
                s.src = `${GlobalConfig.basePath}assets/js/auth.js`;
                s.defer = true;
                document.head.appendChild(s);
            }

            // Intentar proteger la página cuando requireAuth esté disponible
            const tryGuard = () => {
                try {
                    if (typeof window.requireAuth === 'function') {
                        window.requireAuth();
                        return true;
                    }
                } catch (e) {}
                return false;
            };

            if (!tryGuard()) {
                setTimeout(tryGuard, 200);
                setTimeout(tryGuard, 800);
                setTimeout(tryGuard, 1600);
            }
        } catch {}
    }

    /**
     * Inyecta entitlements.js automáticamente en rutas de portal o herramientas si no está presente.
     */
    ensureEntitlementsLoader() {
        try {
            const scripts = Array.from(document.scripts);
            const entScript = scripts.find(s => (s.src || '').includes('assets/js/entitlements.js'));
            const path = (location && location.pathname || '').toLowerCase();
            // Cargar en portal y herramientas por ruta conocida (soporta fase_1_ecd y fase-1-ecd)
            let shouldLoad = /\/portal-alumno\.html$/.test(path)
                || /\/fase[_-]\d+_ecd\//.test(path)
                || /\/fase_\d+_de0a100\//.test(path);
            // Además, si la página contiene elementos con data-entitlement, inyectar (ej. academy, catálogos)
            if (!shouldLoad) {
                try {
                    shouldLoad = !!document.querySelector('[data-entitlement]');
                } catch (_) {}
            }
            // Si ya existe un script directo, normalizar cache-busting y defer
            if (entScript) {
                try {
                    const hasQuery = (entScript.src || '').includes('?');
                    const v = GlobalConfig.assetVersion ? `v=${GlobalConfig.assetVersion}` : '';
                    if (v) {
                        if (hasQuery) {
                            if (!entScript.src.includes('v=')) {
                                entScript.src = `${entScript.src}&${v}`;
                            }
                        } else {
                            entScript.src = `${entScript.src}?${v}`;
                        }
                    }
                    entScript.defer = true;
                } catch (_) {}
            }
            const already = !!entScript;
            if (!already && shouldLoad) {
                const s = document.createElement('script');
                const v = GlobalConfig.assetVersion ? `?v=${GlobalConfig.assetVersion}` : '';
                s.src = `${GlobalConfig.basePath}assets/js/entitlements.js${v}`;
                s.defer = true;
                document.head.appendChild(s);
            }
        } catch {}
    }

    /**
     * Obtiene un componente específico
     * @param {string} name - Nombre del componente
     * @returns {BaseComponent|null} El componente solicitado
     */
    getComponent(name) {
        return this.components.get(name) || null;
    }
}

/**
 * Función utilitaria para inicializar la aplicación cuando el DOM esté listo
 */
function initializeApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Redetectar basePath cuando DOM está listo por si el script fue diferido
            detectBasePath();
            const app = new AppManager();
            app.init();
            
            // Hacer disponible globalmente para debugging
            window.app = app;
        });
    } else {
        detectBasePath();
        const app = new AppManager();
        app.init();
        window.app = app;
    }
}

// Inicializar la aplicación
initializeApp();

/* ============================
     Gamificación: Utilidades comunes
     (IIFE con GameComponents)
     ============================ */
(function (w) {
    const App = {};

    // Ejecuta un callback cuando el DOM está listo
    App.domReady = function (cb) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', cb);
        } else {
            cb();
        }
    };

    // Helpers de selección
    App.qs = (sel, root = document) => root.querySelector(sel);
    App.qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    // Muestra solo un contenedor y oculta el resto (ignora nulos)
    App.showOnly = function (elems, toShow) {
        elems.forEach(el => { if (el) el.classList.add('hidden'); });
        if (toShow) toShow.classList.remove('hidden');
    };

    // Formatea moneda CL
    App.formatCurrencyCL = function (value) {
        try {
            return '$' + Math.round(value).toLocaleString('es-CL');
        } catch (e) {
            return '$' + Math.round(value);
        }
    };

    // Anima un número dentro de un elemento
    App.animateNumber = function (element, start, end, { duration = 1000, suffix = '', decimals = 0 } = {}) {
        if (!element) return;
        let startTs = null;
        const step = (ts) => {
            if (!startTs) startTs = ts;
            const p = Math.min((ts - startTs) / duration, 1);
            const cur = start + (end - start) * p;
            element.textContent = cur.toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    };

    // Pulso visual (útil para métricas)
    App.pulse = function (el, className = 'value-change') {
        if (!el) return;
        el.classList.remove(className);
        void el.offsetWidth; // reflow
        el.classList.add(className);
    };

    w.GameComponents = App;
})(window);
