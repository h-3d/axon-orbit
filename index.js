import * as THREE from 'three';
import FakeGlowMaterial from './FakeGlowMaterial.js';
import { FlyControls } from 'three/addons/controls/FlyControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { joinRoom } from 'https://esm.run/trystero';

document.body.style.margin = 0;

let health = 200;
document.getElementById('hp').textContent = `${health}hp`;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera( 50, window.innerWidth / window.innerHeight, 0.1, 1000 );

document.getElementById('coordinates').textContent = `x: ${Math.round(camera.position.x)} y: ${Math.round(camera.position.y)} z: ${Math.round(camera.position.z)}`;

const renderScene = new RenderPass(scene, camera);

const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );

renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const composer = new EffectComposer(renderer);
composer.addPass(renderScene);

const bloomPass = new UnrealBloomPass( new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.8, 0.4 );
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

window.addEventListener('resize', () => {
    renderer.setSize( window.innerWidth, window.innerHeight );
    composer.setSize( window.innerWidth, window.innerHeight );
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
const controls = new FlyControls( camera, renderer.domElement );
controls.movementSpeed = 200;
controls.rollSpeed = 0.6;
controls.dragToLook = true;
controls.autoForward = false;

window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.getElementById('hp').style.visibility = 'visible';
document.getElementById('coordinates').style.visibility = 'visible';

function generateStars(size, amount, seed, noiseFactor) {
    noise.seed(seed);

    const geometry = new THREE.SphereGeometry( 1, 16, 8 );
    const material = new THREE.MeshBasicMaterial( { color: 0xffffff } );
    const mesh = new THREE.InstancedMesh( geometry, material, amount );
    scene.add(mesh);

    const star = new THREE.Object3D();

    for (let i = 0; i < amount; i++) {
        const x = (noise.simplex3((i * noiseFactor), 0, 0)) * size;
        const y = (noise.simplex3(0, (i * noiseFactor), 0)) * size;
        const z = (noise.simplex3(0, 0, (i * noiseFactor))) * size;

        star.position.set(x, y, z);
        star.updateMatrix();

        mesh.setMatrixAt(i, star.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
}

generateStars(2000, 4000, 67, 0.4);

const loader = new FBXLoader();
let shipSize = new THREE.Vector3(482.82198905944824, 134.960000216961, 387.25000619888306);

const response = await fetch("https://h-3d.metered.live/api/v1/turn/credentials?apiKey=3dc8028a521455f6e0f1aa7fd174b957a75e");
const iceServers = await response.json();

const config = {
    appId: 'axon-orbit',
    relayUrls: [
        'wss://relay.snort.social',
        'wss://nos.lol'
    ],
    turnConfig: iceServers
};

const room = joinRoom(config, 'axon-orbit');

const [sendPosition, getPosition] = room.makeAction('position');
const [sendRotation, getRotation] = room.makeAction('rotation');

const [sendSynchronize, getSynchronize] = room.makeAction('synchronize');
const syncedPositionPeers = new Set();
const syncedRotationPeers = new Set();

const [sendLaser, getLaser] = room.makeAction('laser');

getSynchronize((_, peerId) => {
    sendPosition({ x: camera.position.x, y: camera.position.y, z: camera.position.z }, peerId);
    sendRotation({ x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w }, peerId);
});

const offset = 26.9920000433922;

const peers = new Set();

room.onPeerJoin((peerId) => {
    peers.add(peerId);
    loader.load('./low_poly_space_ship.fbx', (object) => {
        const parent = new THREE.Object3D();
        parent.name = peerId;
        parent.visible = false;
        object.scale.set(0.4, 0.4, 0.4);
        object.scale.z *= -1;
        object.position.y -= offset;
        parent.add(object);

        let attempts = 0;
        const interval = setInterval(() => {
            if((syncedPositionPeers.has(peerId) && syncedRotationPeers.has(peerId)) || !peers.has(peerId) || attempts >= 100) {
                clearInterval(interval);
                return;
            }

            sendSynchronize(null, peerId);
            attempts++;
        }, 200);

        scene.add(parent);
    });
});

room.onPeerLeave((peerId) => {
    peers.delete(peerId);
    syncedPositionPeers.delete(peerId);
    syncedRotationPeers.delete(peerId);
    scene.remove(scene.getObjectByName(peerId));
});

getPosition((data, peerId) => {
    const player = scene.getObjectByName(peerId);
    if (player) {
        player.position.set(data.x, data.y, data.z);
        player.visible = true;
        syncedPositionPeers.add(peerId);
    }
});

getRotation((data, peerId) => {
    const player = scene.getObjectByName(peerId);
    if (player) {
        player.quaternion.set(data.x, data.y, data.z, data.w);
        player.visible = true;
        syncedRotationPeers.add(peerId);
    }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

let isProcessing = false;

let lasers = [];
const laserSpeed = 400;

const laserGeometry = new RoundedBoxGeometry( 4, 4, 20, 4, 0.8 );
const laserMaterial = new FakeGlowMaterial({
    falloff: 2,
    glowInternalRadius: 1,
    glowColor: new THREE.Color("#ff0000"),
    opacity: 4,
    depthTest: false,
    side: THREE.DoubleSide
});

function shootLaser(position, quaternion) {
    const laser = new THREE.Mesh( laserGeometry, laserMaterial );
    laser.position.set(position.x, position.y, position.z);
    laser.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    laser.translateZ(-100);
    laser.userData.owned = true;

    scene.add( laser );
    lasers.push(laser);
}

function receiveLaser(position, quaternion) {
    const laser = new THREE.Mesh( laserGeometry, laserMaterial );
    laser.position.set(position.x, position.y, position.z);
    laser.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    laser.translateZ(-100);
    laser.userData.owned = false;

    scene.add( laser );
    lasers.push(laser);
}

getLaser((data) => {
    receiveLaser(data.position, data.quaternion);
});

async function laserDelay() {
    if(!isProcessing) {
        isProcessing = true;
        shootLaser(camera.position, camera.quaternion);
        sendLaser({ position: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, quaternion: { x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w }});
        await sleep(200);
        isProcessing = false;
    }
}

const playerMesh = new THREE.Mesh(new THREE.BoxGeometry(shipSize.x * 0.4, shipSize.y * 0.5, shipSize.z * 0.5));

function laserCollision(laser) {
    const laserBox = new THREE.Box3().setFromObject(laser);

    playerMesh.position.copy(camera.position);
    playerMesh.quaternion.copy(camera.quaternion);
    playerMesh.updateMatrixWorld(true);
    const playerBox = new THREE.Box3().setFromObject(playerMesh);

    const collision = laserBox.intersectsBox(playerBox);
    return collision;
}

window.addEventListener('keydown', (key) => {
    if(key.code === 'Space' && !key.repeat && camera.position.x <= 2000 && camera.position.y <= 2000 && camera.position.z <= 2000 && camera.position.x >= -2000 && camera.position.y >= -2000 && camera.position.z >= -2000) {
        laserDelay();
    }
});

const lastCameraPosition = new THREE.Vector3();
const lastCameraQuaternion = new THREE.Quaternion();

lastCameraPosition.copy(camera.position);
lastCameraQuaternion.copy(camera.quaternion);

async function burst() {
    let overlay = document.getElementById('overlay');
    overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '1';
    document.body.appendChild(overlay);
    await sleep(1);
    overlay.remove();
}

function animate() {
    const delta = clock.getDelta();
    controls.update( delta );

    let overlay = document.getElementById('overlay');
    if(camera.position.x > 2000 || camera.position.y > 2000 || camera.position.z > 2000 || camera.position.x < -2000 || camera.position.y < -2000 || camera.position.z < -2000) {
        if(!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'overlay';
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            overlay.style.pointerEvents = 'none';
            overlay.style.zIndex = '1';
            document.body.appendChild(overlay);
        }
    } else {
        if(overlay) {
            overlay.remove();
        }
    }

    composer.render();

    const lasersToRemove = [];
    lasers.forEach((laser) => {
        laser.translateZ(-laserSpeed * delta);
        if(laser.position.x > 2000 || laser.position.y > 2000 || laser.position.z > 2000 || laser.position.x < -2000 || laser.position.y < -2000 || laser.position.z < -2000) {
            scene.remove( laser );
            lasersToRemove.push(laser);
        }
        if(!(camera.position.x > 2000 || camera.position.y > 2000 || camera.position.z > 2000 || camera.position.x < -2000 || camera.position.y < -2000 || camera.position.z < -2000) && laserCollision(laser) && !laser.userData.owned) {
            burst();
            health--;
            document.getElementById('hp').textContent = `${health}hp`;
            if (health < 1) {
                camera.position.set(0, 0, 0);
                camera.quaternion.set(0, 0, 0, 1);
                health = 200;
                document.getElementById('hp').textContent = `${health}hp`;
            }
        }
    });

    lasers = lasers.filter((laser) => {
        return !lasersToRemove.includes(laser);
    });

    if (!lastCameraPosition.equals(camera.position)) {
        sendPosition({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
        lastCameraPosition.copy(camera.position);
        document.getElementById('coordinates').textContent = `x: ${Math.round(camera.position.x)} y: ${Math.round(camera.position.y)} z: ${Math.round(camera.position.z)}`;
    }
    if (!lastCameraQuaternion.equals(camera.quaternion)) {
        sendRotation({ x: camera.quaternion.x, y: camera.quaternion.y, z: camera.quaternion.z, w: camera.quaternion.w });
        lastCameraQuaternion.copy(camera.quaternion);
    }
}
renderer.setAnimationLoop( animate );