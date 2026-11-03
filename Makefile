# ============================================================================
#  PortsLauncher — Makefile raíz
#  Indexador propio (catalog-builder/) + launcher web (launcher/)
#
#  Uso:  make            → muestra la ayuda
#        make setup      → prepara el entorno
#        make test       → ejecuta las 3 suites (369 tests)
#        make build      → índice + build del launcher
#        make dev        → servidor de desarrollo
# ============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

PYTHON ?= python3
NPM    ?= npm

LAUNCHER_DIR    := launcher
DATA_DIR        := data
PUBLIC_DATA_DIR := $(LAUNCHER_DIR)/public/data
INDEX           := $(DATA_DIR)/ports.index.json
PUBLIC_INDEX    := $(PUBLIC_DATA_DIR)/ports.index.json
TEST_OUT        := .test-out

# --- Colores ANSI -----------------------------------------------------------
BOLD  := \033[1m
DIM   := \033[2m
CYAN  := \033[36m
PINK  := \033[35m
GREEN := \033[32m
YELLW := \033[33m
RED   := \033[31m
RST   := \033[0m

.PHONY: help setup extract-fixtures test-fixtures test-builder test-launcher test \
        build-index build-launcher build sync-catalog dev preview

# ----------------------------------------------------------------------------
#  Ayuda
# ----------------------------------------------------------------------------
help: ## Muestra esta ayuda con todos los comandos disponibles
	@printf '\n $(PINK)$(BOLD)PORTSHUB$(RST) $(DIM)— comandos disponibles$(RST)\n\n'
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\n $(DIM)Ejemplos:$(RST)\n'
	@printf '   $(DIM)make setup$(RST)   instala dependencias y crea carpetas de datos\n'
	@printf '   $(DIM)make test$(RST)    corre fixtures + indexador + launcher (369 tests)\n'
	@printf '   $(DIM)make build$(RST)   genera data/ports.index.json y launcher/dist\n'
	@printf '   $(DIM)make dev$(RST)     servidor Vite en http://localhost:5173\n\n'

# ----------------------------------------------------------------------------
#  Entorno
# ----------------------------------------------------------------------------
setup: ## Prepara el entorno: versiones, npm install y carpetas de datos
	@printf '\n $(CYAN)$(BOLD)▶ setup$(RST)\n\n'
	@printf '   %-10s' 'python3 :'; $(PYTHON) --version
	@printf '   %-10s' 'node    :'; node --version 2>/dev/null || printf 'no encontrado\n'
	@printf '   %-10s' 'npm     :'; $(NPM) --version
	@printf '\n $(DIM)instalando dependencias del launcher…$(RST)\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) install
	@mkdir -p $(DATA_DIR)
	@mkdir -p $(PUBLIC_DATA_DIR)
	@printf '\n $(GREEN)✔$(RST) setup completado $(DIM)(data/ y %s/ listos)$(RST)\n\n' '$(PUBLIC_DATA_DIR)'

# ----------------------------------------------------------------------------
#  Fixtures
# ----------------------------------------------------------------------------
extract-fixtures: ## Extrae los fixtures JSON desde los HAR de Documentación/
	@printf '\n $(CYAN)$(BOLD)▶ extract-fixtures$(RST)\n\n'
	@$(PYTHON) tools/extract_har.py

test-fixtures: ## Ejecuta las pruebas de fixtures (9 tests, unittest)
	@printf '\n $(CYAN)$(BOLD)▶ test-fixtures$(RST) $(DIM)9 tests$(RST)\n\n'
	@$(PYTHON) -m unittest tools/test_fixtures.py

# ----------------------------------------------------------------------------
#  Pruebas
# ----------------------------------------------------------------------------
test-builder: ## Ejecuta las pruebas del indexador (106 tests, unittest)
	@printf '\n $(CYAN)$(BOLD)▶ test-builder$(RST) $(DIM)106 tests$(RST)\n\n'
	@$(PYTHON) -m unittest discover -s catalog-builder/tests -v

test-launcher: ## Ejecuta las pruebas del launcher (254 tests, vitest)
	@printf '\n $(CYAN)$(BOLD)▶ test-launcher$(RST) $(DIM)254 tests$(RST)\n\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) test

test: ## Ejecuta las 3 suites (369 tests) y muestra un reporte unificado
	@printf '\n $(PINK)$(BOLD)════════════════════════════════════════════════════════════$(RST)\n'
	@printf ' $(PINK)$(BOLD)  PORTSHUB$(RST) $(DIM)· suite completa de pruebas$(RST)\n'
	@printf ' $(PINK)$(BOLD)════════════════════════════════════════════════════════════$(RST)\n'
	@mkdir -p $(TEST_OUT)
	@printf '\n $(BOLD)[1/3] Fixtures del catálogo$(RST) $(DIM)(unittest · 9 tests)$(RST)\n'
	@$(PYTHON) -m unittest tools/test_fixtures.py > $(TEST_OUT)/1-fixtures.log 2>&1 && printf 1 > $(TEST_OUT)/1-fixtures.ok || printf 0 > $(TEST_OUT)/1-fixtures.ok
	@tail -n 4 $(TEST_OUT)/1-fixtures.log | sed 's/^/       /'
	@printf '\n $(BOLD)[2/3] Indexador catalog-builder$(RST) $(DIM)(unittest · 106 tests)$(RST)\n'
	@$(PYTHON) -m unittest discover -s catalog-builder/tests -v > $(TEST_OUT)/2-builder.log 2>&1 && printf 1 > $(TEST_OUT)/2-builder.ok || printf 0 > $(TEST_OUT)/2-builder.ok
	@tail -n 4 $(TEST_OUT)/2-builder.log | sed 's/^/       /'
	@printf '\n $(BOLD)[3/3] Launcher$(RST) $(DIM)(vitest · 254 tests)$(RST)\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) test > $(TEST_OUT)/3-launcher.log 2>&1 && printf 1 > $(TEST_OUT)/3-launcher.ok || printf 0 > $(TEST_OUT)/3-launcher.ok
	@tail -n 6 $(TEST_OUT)/3-launcher.log | sed 's/^/       /'
	@printf '\n $(PINK)$(BOLD)────────────────────────────────────────────────────────────$(RST)\n'
	@printf ' $(PINK)$(BOLD)  REPORTE UNIFICADO$(RST)\n'
	@printf ' $(PINK)$(BOLD)────────────────────────────────────────────────────────────$(RST)\n'
	@f_ok=$$(cat $(TEST_OUT)/1-fixtures.ok 2>/dev/null || printf 0); \
	 b_ok=$$(cat $(TEST_OUT)/2-builder.ok 2>/dev/null || printf 0); \
	 l_ok=$$(cat $(TEST_OUT)/3-launcher.ok 2>/dev/null || printf 0); \
	 f_n=$$(grep -hoE 'Ran [0-9]+ tests?' $(TEST_OUT)/1-fixtures.log 2>/dev/null | grep -oE '[0-9]+' | tail -n 1); \
	 b_n=$$(grep -hoE 'Ran [0-9]+ tests?' $(TEST_OUT)/2-builder.log 2>/dev/null | grep -oE '[0-9]+' | tail -n 1); \
	 l_n=$$(grep -hoE 'Tests[[:space:]]+[0-9]+ passed' $(TEST_OUT)/3-launcher.log 2>/dev/null | grep -oE '[0-9]+' | tail -n 1); \
	 f_n=$${f_n:-0}; b_n=$${b_n:-0}; l_n=$${l_n:-0}; \
	 total=$$(( f_n + b_n + l_n )); \
	 st() { if [ "$$1" -eq 1 ]; then printf '\033[32mPASS\033[0m'; else printf '\033[31mFAIL\033[0m'; fi; }; \
	 printf '   %-26s %5s   %s\n' 'Fixtures (esperado 9)'   "$$f_n" "$$(st $$f_ok)"; \
	 printf '   %-26s %5s   %s\n' 'Indexador (esperado 106)' "$$b_n" "$$(st $$b_ok)"; \
	 printf '   %-26s %5s   %s\n' 'Launcher (esperado 254)' "$$l_n" "$$(st $$l_ok)"; \
	 printf '   %-26s %5s\n'       'TOTAL (esperado 369)'   "$$total"; \
	 if [ "$$total" -eq 369 ]; then \
	   printf '\n   \033[32m✔ 369 tests contabilizados\033[0m\n'; \
	 else \
	   printf '\n   \033[33m⚠ esperados 369 tests, contabilizados %s\033[0m\n' "$$total"; \
	 fi; \
	 if [ "$$f_ok" -eq 1 ] && [ "$$b_ok" -eq 1 ] && [ "$$l_ok" -eq 1 ]; then rc=0; printf '\n   \033[32m✔ toda la suite en verde\033[0m\n\n'; else rc=1; printf '\n   \033[31m✖ hay suites con fallos — logs en %s/\033[0m\n\n' '$(TEST_OUT)'; fi; \
	 exit $$rc

# ----------------------------------------------------------------------------
#  Build
# ----------------------------------------------------------------------------
build-index: ## Genera data/ports.index.json y lo publica en launcher/public/data/
	@printf '\n $(CYAN)$(BOLD)▶ build-index$(RST) $(DIM)--offline$(RST)\n\n'
	@if ! $(PYTHON) -m catalog-builder.builder --offline; then \
	  printf '\n $(YELLW)⚠ "$(PYTHON) -m catalog-builder.builder" no es invocable como módulo (nombre con guion); usando ejecución directa$(RST)\n\n'; \
	  $(PYTHON) catalog-builder/builder.py --offline; \
	fi
	@test -f $(INDEX) || { printf ' $(RED)✖ no se generó %s$(RST)\n' '$(INDEX)'; exit 1; }
	@mkdir -p $(PUBLIC_DATA_DIR)
	@cp $(INDEX) $(PUBLIC_INDEX)
	@printf '\n $(GREEN)✔$(RST) %s $(DIM)→$(RST) %s\n\n' '$(INDEX)' '$(PUBLIC_INDEX)'

build-launcher: ## Compila el launcher (tsc + vite build) en launcher/dist/
	@printf '\n $(CYAN)$(BOLD)▶ build-launcher$(RST)\n\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) run build
	@printf '\n $(GREEN)✔$(RST) %s generado\n\n' '$(LAUNCHER_DIR)/dist'

build: build-index build-launcher ## Construye el índice y el launcher (build completo)
	@test -f $(PUBLIC_INDEX) || { printf ' $(RED)✖ falta %s$(RST)\n' '$(PUBLIC_INDEX)'; exit 1; }
	@test -f $(LAUNCHER_DIR)/dist/index.html || { printf ' $(RED)✖ falta %s$(RST)\n' '$(LAUNCHER_DIR)/dist/index.html'; exit 1; }
	@printf '\n $(GREEN)$(BOLD)✔ build completo$(RST)\n'
	@printf '   índice : %s $(DIM)(%s bytes)$(RST)\n' '$(PUBLIC_INDEX)' "$$(wc -c < '$(PUBLIC_INDEX)' | tr -d ' ')"
	@printf '   bundle : %s\n\n' '$(LAUNCHER_DIR)/dist'
	@printf ' $(DIM)sirve el resultado con:$(RST) make preview\n\n'

# ----------------------------------------------------------------------------
#  Sincronización de catálogo
# ----------------------------------------------------------------------------
sync-catalog: ## Sincroniza el catálogo en un comando (builder + publicación del índice)
	@printf '\n $(CYAN)$(BOLD)▶ sync-catalog$(RST) $(DIM)tools/sync_catalog.sh$(RST)\n\n'
	@bash tools/sync_catalog.sh $(ARGS)
	@printf '\n $(GREEN)✔$(RST) catálogo sincronizado $(DIM)(log: $(DATA_DIR)/sync.log)$(RST)\n\n'

# ----------------------------------------------------------------------------
#  Desarrollo
# ----------------------------------------------------------------------------
dev: ## Servidor de desarrollo Vite en http://localhost:5173
	@printf '\n $(CYAN)$(BOLD)▶ dev$(RST) $(DIM)http://localhost:5173$(RST)\n\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) run dev -- --port 5173

preview: ## Sirve el build de producción en http://localhost:5173
	@printf '\n $(CYAN)$(BOLD)▶ preview$(RST) $(DIM)http://localhost:5173$(RST)\n\n'
	@$(NPM) --prefix $(LAUNCHER_DIR) run preview -- --port 5173
