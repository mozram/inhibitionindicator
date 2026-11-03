NAME=inhibitionindicator
DOMAIN=monyxie.github.io

.PHONY: lint pack install clean veryclean js dist

node_modules: package.json
	npm install

lint: node_modules
	npm run lint

js: lint
	@rm -rf dist
	./node_modules/.bin/tsc

dist: js
	@cp src/metadata.json dist/

$(NAME).zip: dist
	@rm -f $@
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
