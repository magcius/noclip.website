
// Workaround for not having gl-matrix typings available.
interface Window {
    mat4: any;
    vec3: any;
}

/// <reference path="nitro_bmd.ts">

namespace Render {

    function fetch(path, responseType="arraybuffer") {
        var request = new XMLHttpRequest();
        request.open("GET", path, true);
        request.responseType = responseType;
        request.send();
        return request;
    }

    // A dumb hack to have "multiline strings".
    function M(X) { return X.join('\n'); }

    function compileShader(gl, str, type) {
        var shader = gl.createShader(type);

        gl.shaderSource(shader, str);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            return null;
        }

        return shader;
    }

    var DL_VERT_SHADER_SOURCE = M([
        'precision mediump float;',
        'uniform mat4 u_modelView;',
        'uniform mat4 u_localMatrix;',
        'uniform mat4 u_projection;',
        'uniform mat4 u_texCoordMat;',
        'attribute vec3 a_position;',
        'attribute vec2 a_uv;',
        'attribute vec4 a_color;',
        'varying vec4 v_color;',
        'varying vec2 v_uv;',
        '',
        'void main() {',
        '    gl_Position = u_projection * u_modelView * u_localMatrix * vec4(a_position, 1.0);',
        '    v_color = a_color;',
        '    v_uv = (u_texCoordMat * vec4(a_uv, 1.0, 1.0)).st;',
        '}',
    ]);

    var DL_FRAG_SHADER_SOURCE = M([
        'precision mediump float;',
        'varying vec2 v_uv;',
        'varying vec4 v_color;',
        'uniform sampler2D u_texture;',
        '',
        'void main() {',
        '    gl_FragColor = texture2D(u_texture, v_uv);',
        '    gl_FragColor *= v_color;',
        '    if (gl_FragColor.a == 0.0)',
        '        discard;',
        '}',
    ]);

    function createProgram_DL(gl) {
        var vertShader = compileShader(gl, DL_VERT_SHADER_SOURCE, gl.VERTEX_SHADER);
        var fragShader = compileShader(gl, DL_FRAG_SHADER_SOURCE, gl.FRAGMENT_SHADER);
        var prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        prog.modelViewLocation = gl.getUniformLocation(prog, "u_modelView");
        prog.projectionLocation = gl.getUniformLocation(prog, "u_projection");
        prog.localMatrixLocation = gl.getUniformLocation(prog, "u_localMatrix");
        prog.texCoordMatLocation = gl.getUniformLocation(prog, "u_texCoordMat");
        prog.txsLocation = gl.getUniformLocation(prog, "u_txs");
        prog.positionLocation = gl.getAttribLocation(prog, "a_position");
        prog.colorLocation = gl.getAttribLocation(prog, "a_color");
        prog.uvLocation = gl.getAttribLocation(prog, "a_uv");
        return prog;
    }

    // 3 pos + 4 color + 2 uv
    var VERTEX_SIZE = 9;
    var VERTEX_BYTES = VERTEX_SIZE * Float32Array.BYTES_PER_ELEMENT;

    function translateBMD(gl, bmd) {
        var model:any = {};

        var RenderPass = {
            OPAQUE: 0x01,
            TRANSLUCENT: 0x02,
        };

        function translatePacket(packet) {
            var vertBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, packet.vertData, gl.STATIC_DRAW);

            var idxBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, packet.idxData, gl.STATIC_DRAW);

            return function() {
                var prog = gl.currentProgram;
                gl.bindBuffer(gl.ARRAY_BUFFER, vertBuffer);
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuffer);
                gl.vertexAttribPointer(prog.positionLocation, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
                gl.vertexAttribPointer(prog.colorLocation, 4, gl.FLOAT, false, VERTEX_BYTES, 3 * Float32Array.BYTES_PER_ELEMENT);
                gl.vertexAttribPointer(prog.uvLocation, 2, gl.FLOAT, false, VERTEX_BYTES, 7 * Float32Array.BYTES_PER_ELEMENT);
                gl.enableVertexAttribArray(prog.positionLocation);
                gl.enableVertexAttribArray(prog.colorLocation);
                gl.enableVertexAttribArray(prog.uvLocation);
                gl.drawElements(gl.TRIANGLES, packet.idxData.length, gl.UNSIGNED_SHORT, 0);
                gl.disableVertexAttribArray(prog.positionLocation);
                gl.disableVertexAttribArray(prog.colorLocation);
                gl.disableVertexAttribArray(prog.uvLocation);
            };
        }

        function translatePoly(poly) {
            var funcs = poly.packets.map(translatePacket);
            return function(state) {
                funcs.forEach(function(f) { f(state); });
            };
        }

        function translateMaterial(material) {
            var texture = material.texture;

            if (texture !== null) {
                var texId = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

                var repeatS = (material.texParams >> 16) & 0x01;
                var repeatT = (material.texParams >> 17) & 0x01;
                var flipS = (material.texParams >> 18) & 0x01;
                var flipT = (material.texParams >> 19) & 0x01;

                function wrapMode(repeat, flip) {
                    if (repeat)
                        return flip ? gl.MIRRORED_REPEAT : gl.REPEAT;
                    else
                        return gl.CLAMP_TO_EDGE; 
                }

                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode(repeatS, flipS));
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode(repeatT, flipT));

                gl.bindTexture(gl.TEXTURE_2D, texId);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.width, texture.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
            }

            return function(state) {
                if (texture !== null) {
                    gl.uniformMatrix4fv(gl.currentProgram.texCoordMatLocation, false, material.texCoordMat);
                    gl.bindTexture(gl.TEXTURE_2D, texId);
                }

                gl.depthMask(material.depthWrite);
            };
        }

        function translateBatch(batch) {
            var batchPass = batch.material.isTranslucent ? RenderPass.TRANSLUCENT : RenderPass.OPAQUE;

            var applyMaterial = translateMaterial(batch.material);
            var renderPoly = translatePoly(batch.poly);
            return function(state) {
                if (state.renderPass != batchPass)
                    return;
                applyMaterial(state);
                renderPoly(state);
            };
        }

        function translateModel(bmdm) {
            var localMatrix = window.mat4.create();
            window.mat4.scale(localMatrix, localMatrix, [bmd.scaleFactor, bmd.scaleFactor, bmd.scaleFactor]);
            var batches = bmdm.batches.map(translateBatch);
            return function(state) {
                gl.uniformMatrix4fv(gl.currentProgram.localMatrixLocation, false, localMatrix);
                batches.forEach(function(f) { f(state); });
            };
        }

        var modelFuncs = bmd.models.map(translateModel);
        function renderModels(state) {
            modelFuncs.forEach(function(f) { f(state); });
        }

        model.render = function(state) {
            state.useProgram(state.programs_DL);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

            // First pass, opaque.
            state.renderPass = RenderPass.OPAQUE;
            renderModels(state);

            // Second pass, translucent.
            state.renderPass = RenderPass.TRANSLUCENT;
            renderModels(state);
        };

        return model;
    }

    function createSceneGraph(gl) {
        var projection = window.mat4.create();
        window.mat4.perspective(projection, Math.PI / 4, gl.viewportWidth / gl.viewportHeight, 0.2, 50000);

        var view = window.mat4.create();

        gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
        gl.clearColor(200/255, 50/255, 153/255, 1);

        var models = [];
        var scene:any = {};

        var state:any = {};
        state.gl = gl;
        state.programs_DL = createProgram_DL(gl);
        state.useProgram = function(prog) {
            gl.currentProgram = prog;
            gl.useProgram(prog);
            gl.uniformMatrix4fv(prog.projectionLocation, false, projection);
            gl.uniformMatrix4fv(prog.modelViewLocation, false, view);
            return prog;
        };

        function renderModel(model) {
            model.render(state);
        }

        function render() {
            gl.depthMask(true);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            models.forEach(renderModel);
        }

        scene.setModels = function(models_) {
            models = models_;
            render();
        };
        scene.setCamera = function(matrix) {
            window.mat4.invert(view, matrix);
            render();
        };
        scene.render = function() {
            render();
        };

        return scene;
    }

    function createViewer() {
        var canvas = document.querySelector("canvas");
        var gl = canvas.getContext("webgl", { alpha: false });

        (<any> gl).viewportWidth = canvas.width;
        (<any> gl).viewportHeight = canvas.height;

        var scene = createSceneGraph(gl);

        var camera = window.mat4.create();
        var filename = '';

        var viewer:any = {};
        viewer.gl = gl;
        viewer.resetCamera = function() {
            window.mat4.identity(camera);
            scene.setCamera(camera);
        };
        viewer.setBMD = function(bmd) {
            var model = translateBMD(gl, bmd);
            scene.setModels([model]);

            viewer.resetCamera();
        };
        viewer.loadScene = function(filename) {
            fetch(filename).onload = function() {
                var textures = document.querySelector('#textures');
                textures.innerHTML = '';

                var r = this.response;
                var decompressed = LZ77.decompress(r);
                var bmd = NITRO_BMD.parse(decompressed);
                viewer.setBMD(bmd);
            };
        };

        var keysDown = {};
        var SHIFT = 16;

        function isKeyDown(key) {
            return !!keysDown[key.charCodeAt(0)];
        }

        window.addEventListener('keydown', function(e) {
            keysDown[e.keyCode] = true;
        });
        window.addEventListener('keyup', function(e) {
            delete keysDown[e.keyCode];
        });

        function elemDragger(elem, callback) {
            var lx, ly;

            function mousemove(e) {
                var dx = e.pageX - lx, dy = e.pageY - ly;
                lx = e.pageX; ly = e.pageY;
                callback(dx, dy);
            }
            function mouseup(e) {
                document.removeEventListener('mouseup', mouseup);
                document.removeEventListener('mousemove', mousemove);
                document.body.classList.remove('grabbing');
            }
            elem.addEventListener('mousedown', function(e) {
                lx = e.pageX; ly = e.pageY;
                document.addEventListener('mouseup', mouseup);
                document.addEventListener('mousemove', mousemove);
                document.body.classList.add('grabbing');
                e.preventDefault();
            });
        }

        elemDragger(canvas, function(dx, dy) {
            var cu = [camera[1], camera[5], camera[9]];
            window.vec3.normalize(cu, cu);
            window.mat4.rotate(camera, camera, -dx / 500, cu);
            window.mat4.rotate(camera, camera, -dy / 500, [1, 0, 0]);
        });

        var tmp = window.mat4.create();
        var t = 0;
        function update(nt) {
            var dt = nt - t;
            t = nt;

            var mult = .1;
            if (keysDown[SHIFT])
                mult *= 5;
            mult *= (dt / 16.0);

            var amt;
            amt = 0;
            if (isKeyDown('W'))
                amt = -mult;
            else if (isKeyDown('S'))
                amt = mult;
            tmp[14] = amt;

            amt = 0;
            if (isKeyDown('A'))
                amt = -mult;
            else if (isKeyDown('D'))
                amt = mult;
            tmp[12] = amt;

            amt = 0;
            if (isKeyDown('Q'))
                amt = -mult;
            else if (isKeyDown('E'))
                amt = mult;
            tmp[13] = amt;

            if (isKeyDown('B'))
                window.mat4.identity(camera);
            if (isKeyDown('C'))
                console.log(camera);

            window.mat4.multiply(camera, camera, tmp);

            scene.setCamera(camera);
            window.requestAnimationFrame(update);
        }
        update(0);

        return viewer;
    }

    var manifest = [
        { filename: 'exk/battan_king_map_all.bmd', },
        { filename: 'exk/bombhei_map_all.bmd', },
        { filename: 'exk/castle_1f_all.bmd', },
        { filename: 'exk/castle_2f_all.bmd', },
        { filename: 'exk/castle_b1_all.bmd', },
        { filename: 'exk/cave_all.bmd', },
        { filename: 'exk/clock_tower_all.bmd', },
        { filename: 'exk/desert_land_all.bmd', },
        { filename: 'exk/desert_py_all.bmd', },
        { filename: 'exk/ex_l_map_all.bmd', },
        { filename: 'exk/ex_luigi_all.bmd', },
        { filename: 'exk/ex_m_map_all.bmd', },
        { filename: 'exk/ex_mario_all.bmd', },
        { filename: 'exk/ex_w_map_all.bmd', },
        { filename: 'exk/ex_wario_all.bmd', },
        { filename: 'exk/fire_land_all.bmd', },
        { filename: 'exk/fire_mt_all.bmd', },
        { filename: 'exk/habatake_all.bmd', },
        { filename: 'exk/high_mt_all.bmd', },
        { filename: 'exk/high_slider_all.bmd', },
        { filename: 'exk/horisoko_all.bmd', },
        { filename: 'exk/kaizoku_irie_all.bmd', },
        { filename: 'exk/kaizoku_ship_all.bmd', },
        { filename: 'exk/koopa1_boss_all.bmd', },
        { filename: 'exk/koopa1_map_all.bmd', },
        { filename: 'exk/koopa2_boss_all.bmd', },
        { filename: 'exk/koopa2_map_all.bmd', },
        { filename: 'exk/koopa3_boss_all.bmd', },
        { filename: 'exk/koopa3_map_all.bmd', },
        { filename: 'exk/main_castle_all.bmd', },
        { filename: 'exk/main_garden_all.bmd', },
        { filename: 'exk/metal_switch_all.bmd', },
        { filename: 'exk/playroom_all.bmd', },
        { filename: 'exk/rainbow_cruise_all.bmd', },
        { filename: 'exk/rainbow_mario_all.bmd', },
        { filename: 'exk/snow_kama_all.bmd', },
        { filename: 'exk/snow_land_all.bmd', },
        { filename: 'exk/snow_mt_all.bmd', },
        { filename: 'exk/snow_slider_all.bmd', },
        { filename: 'exk/suisou_all.bmd', },
        { filename: 'exk/teresa_house_all.bmd', },
        { filename: 'exk/test_map_all.bmd', },
        { filename: 'exk/test_map_b_all.bmd', },
        { filename: 'exk/tibi_deka_d_all.bmd', },
        { filename: 'exk/tibi_deka_in_all.bmd', },
        { filename: 'exk/tibi_deka_t_all.bmd', },
        { filename: 'exk/water_city_all.bmd', },
        { filename: 'exk/water_land_all.bmd', },
    ];

    function sceneCombo(gl, viewer) {
        var pl = document.querySelector('#pl');

        var select = document.createElement('select');
        manifest.forEach(function(entry) {
            var option = document.createElement('option');
            option.textContent = entry.filename;
            (<any>option).filename = entry.filename;
            select.appendChild(option);
        });
        pl.appendChild(select);
        var button = document.createElement('button');
        button.textContent = 'Load';
        button.addEventListener('click', function() {
            var option = select.childNodes[select.selectedIndex];
            viewer.loadScene((<any>option).filename);
        });
        pl.appendChild(button);
    }

    window.addEventListener('load', function() {
        var viewer = createViewer();
        sceneCombo(viewer.gl, viewer);
    });
};
