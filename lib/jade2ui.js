var lex = require('jade-lexer');
var parse = require('jade-parser');
var fs = require("fs");

const blessed = require('blessed');

function toHtml(ast, screen, ui, event_handlers, depth=0){
    var result = "";

    if(ast.type == "Block") {
        for(var n in ast.nodes){
            result += toHtml(ast.nodes[n], screen, ui, event_handlers, depth);
        }
    }else if(ast.type == 'Tag'){

        ///////////////////////////////////////
        var space = ' '.repeat(depth * 2);
            //result += depth;

        var attrs = [];
        var params = {};
        for(var a in ast.attrs){
            var attr = ast.attrs[a];
            attrs.push( attr.name + '=' + attr.val)

            if(attr.val[0] == "'"){
                var content = attr.val.substring(1, attr.val.length - 1);;
                if( content[0]=='{') {
                    params[attr.name] = JSON.parse(content);
                }else{
                    params[attr.name] = content;
                }
            }else {
                params[attr.name] = JSON.parse(attr.val);
            }
        }

        params.parent = screen;
        if(screen) {
            var element = blessed[ast.name](params);
            for(var p in params){
                if(p.startsWith('on')){
                    var handler = event_handlers[ params[p] ];
                    if(p.startsWith('onkey')){
                        var key=p.substr(5);
                        element.key([key], handler);
                    }else{
                        element.on(p.substr(2), handler);
                    }
                }
            }
            if(params.id) ui[params.id] = element;
        }

        var attrsStr = attrs.join(' ')
        if(attrsStr) attrsStr = ' ' + attrsStr;

        if(ast.selfClosing){
            result += space +  "<" + ast.name + attrsStr + "/>\n";
        } else{
            result += space +  "<" + ast.name + attrsStr + ">\n";
            if(ast.block) result += toHtml(ast.block, screen, ui, event_handlers, depth+1);
            result += space + "</" + ast.name + ">\n";
        }

    }

    return result;
}

function toCli(ast, screen, ui, event_handlers) {

    //let self = this;
    //self.screen = screen;
    ui.screen = screen;

    toHtml(ast, screen, ui, event_handlers)

    //TODO: move this to dynamic event handler
    screen.key(['escape'], function (ch, key) {
        screen.destroy();
        // console.log('the machine:', self.oracle.machine);
        // console.log('the mempool:', self.oracle.mempool);
        process.exit();
    });

    //return;

    /*self.screen.key(['escape'], event_handlers.on_screen_key_esc);

    self.controls = blessed.box({
        parent: self.screen,
        border: {
            type: 'line'
        },
        bottom: 0,
        height: 3
    });

    self.form = blessed.form({
        parent: self.screen,
        keys: true
    });

    self.textbox = blessed.textbox({
        parent: self.form,
        name: 'input',
        input: true,
        inputOnFocus: true,
        focused: true,
        value: '',
        bottom: 1,
        mouse: true,
        height: 3,
        width: '100%',
        border: {
            type: 'line'
        },
        keys: true
    });

    self.submit = blessed.button({
        parent: self.form,
        mouse: true,
        // keys: true,
        shrink: true,
        bottom: 0,
        right: 0,
        name: 'submit',
        content: '[ENTER] Send',
        style: {
            bg: 'blue'
        },
        padding: {
            left: 1,
            right: 1
        }
    });

    self.instructions = blessed.box({
        parent: self.screen,
        content: '[ESCAPE (2x)] exit]',
        bottom: 0,
        height: 1,
        width: '100%-20',
        padding: {
            left: 1,
            right: 1
        }
    });

    self.history = blessed.box({
        parent: self.screen,
        label: '[ History ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        height: '100%-16',
        width: '80%',
        bottom: 16,
        border: {
            type: 'line'
        }
    });

    self.peerlist = blessed.list({
        parent: self.screen,
        label: '[ Peers ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        top: 0,
        left: '80%+1',
        bottom: 4,
        right: 0,
        border: {
            type: 'line'
        },
        scrollbar: {}
    });

    self.logs = blessed.list({
        parent: self.screen,
        label: '[ Logs ]',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        mouse: true,
        height: 12,
        width: '80%',
        bottom: 4,
        border: {
            type: 'line'
        },
        scrollbar: {}
    });

    self.textbox.key(['enter'], event_handlers.on_textbox_key_enter);

    self.textbox.key(['up'], event_handlers.on_textbox_key_up);

    self.submit.on('press', event_handlers.on_submit_press);

    self.form.on('submit', event_handlers.on_form_submit);*/

};

function renderJadeFile(filename, ui, event_handlers){
    var src = fs.readFileSync(filename, 'utf8');
    console.log(src);
    var tokens = lex(src);
    console.log(tokens);
    var ast = parse(tokens, {filename, src});
    console.log(JSON.stringify(ast, null, '  '))

    var html = toHtml(ast);
    console.log(html);

    var screen = blessed.screen();
    toCli(ast, screen, ui, event_handlers);
    screen.render();
}



//renderJadeFile('./assets/cli2.jade');

module.exports = {
    renderJadeFile
};


