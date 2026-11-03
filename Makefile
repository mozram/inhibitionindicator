NAME=inhibitionindicator
DOMAIN=monyxie.github.io

.PHONY: lint pack install clean veryclean js schemas dist

node_modules: package.json
	npm install

lint: node_modules
	npm run lint

js: lint
	./node_modules/.bin/tsc

schemas: src/schemas/org.gnome.shell.extensions.$(NAME).gschema.xml
	glib-compile-schemas --strict src/schemas

dist: js schemas
	@cp -r src/assets dist/
	@cp -r src/schemas dist/
	@cp src/prefs.xml dist/
	@cp src/metadata.json dist/

$(NAME).zip: dist
	@(cd dist && zip ../$(NAME).zip -9r . -x schemas/gschemas.compiled)

pack: $(NAME).zip

install: dist
	@touch ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)
	@rm -rf ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)
	@mv dist ~/.local/share/gnome-shell/extensions/$(NAME)@$(DOMAIN)

clean:
	@rm -rf dist $(NAME).zip

veryclean: clean
	@rm -rf node_modules
