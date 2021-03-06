import base64 from 'base64-arraybuffer'
import sha256 from './sha-256'
import hkdf from './hkdf'
import aesKw from './aes-kw'
import aesGcm from './aes-gcm'
import { appendBuffer, stringToArrayBuffer } from './utils'

const ECDSA_ALGORITHM_NAME = 'ECDSA'
const KEY_IS_EXTRACTABLE = true
const KEY_PAIR_WILL_BE_USED_TO = ['sign', 'verify']
const PRIVATE_KEY_WILL_BE_USED_TO = ['sign']
const PUBLIC_KEY_WILL_BE_USED_TO = ['verify']
const PUBLIC_KEY_TYPE = 'spki'

const ECDSA_KEY_WRAPPER = 'ecdsa-key-wrapper'

/**
 * NIST recommendation:
 *
 * 128-bit security provided with 256-bit key size
 *
 * Pg. 55
 * https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-57pt1r5.pdf
 *
 **/
const NAMED_CURVE = 'P-256'

const ECDSA_PARAMS = {
  name: ECDSA_ALGORITHM_NAME,
  namedCurve: NAMED_CURVE
}

const ECDSA_SIGNING_PARAMS = {
  name: ECDSA_ALGORITHM_NAME,
  hash: { name: sha256.HASH_ALGORITHM_NAME }
}

const generateKeyPair = async () => {
  const keyPair = await window.crypto.subtle.generateKey(
    ECDSA_PARAMS,
    KEY_IS_EXTRACTABLE,
    KEY_PAIR_WILL_BE_USED_TO
  )
  return keyPair
}

const getPublicKeyFromRawPublicKey = async (rawPublicKey) => {
  const publicKey = await window.crypto.subtle.importKey(
    PUBLIC_KEY_TYPE,
    rawPublicKey,
    ECDSA_PARAMS,
    KEY_IS_EXTRACTABLE,
    PUBLIC_KEY_WILL_BE_USED_TO
  )
  return publicKey
}

const getRawPublicKeyFromPublicKey = async (publicKey) => {
  const rawPublicKey = await window.crypto.subtle.exportKey(PUBLIC_KEY_TYPE, publicKey)
  return rawPublicKey
}

const getPublicKeyStringFromPublicKey = async (publicKey) => {
  const rawPublicKey = await getRawPublicKeyFromPublicKey(publicKey)
  const publicKeyString = base64.encode(rawPublicKey)
  return publicKeyString
}

const getPublicKeyFromPrivateKey = async (privateKey) => {
  const jwkPrivateKey = await window.crypto.subtle.exportKey('jwk', privateKey)

  // delete private key data
  delete jwkPrivateKey.d

  // set public key key_ops to enable import as public key
  jwkPrivateKey.key_ops = PUBLIC_KEY_WILL_BE_USED_TO

  const publicKey = await window.crypto.subtle.importKey(
    'jwk',
    jwkPrivateKey, // technically this now has same values as the public key would
    ECDSA_PARAMS,
    KEY_IS_EXTRACTABLE,
    PUBLIC_KEY_WILL_BE_USED_TO
  )

  return publicKey
}

const importEcdsaKeyWrapperFromMaster = async (masterKey, salt) => {
  const keyWrapper = await window.crypto.subtle.deriveKey(
    hkdf.getParams(ECDSA_KEY_WRAPPER, salt),
    masterKey,
    aesGcm.getEncryptionKeyParams(), // must use aes-gcm kw for ECDSA with WebCrypto
    aesKw.KEY_IS_NOT_EXTRACTABLE,
    aesKw.KEY_WILL_BE_USED_TO
  )
  return keyWrapper
}

const wrapEcdsaPrivateKey = async (ecdsaPrivateKey, ecdsaKeyWrapper) => {
  const iv = aesGcm.generateIv()

  // this result is the concatenation of Array Buffers [ciphertext, auth tag]
  const ciphertextArrayBuffer = await window.crypto.subtle.wrapKey(
    aesKw.KEY_TYPE,
    ecdsaPrivateKey,
    ecdsaKeyWrapper,
    aesGcm.getCiphertextParams(iv)
  )

  return appendBuffer(ciphertextArrayBuffer, iv)
}

const unwrapEcdsaPrivateKey = async (wrappedEcdsaPrivateKey, ecdsaKeyWrapper) => {
  const { ciphertextArrayBuffer, iv } = aesGcm.sliceEncryptedArrayBuffer(wrappedEcdsaPrivateKey)

  const ecdsaPrivateKey = await window.crypto.subtle.unwrapKey(
    aesKw.KEY_TYPE,
    ciphertextArrayBuffer,
    ecdsaKeyWrapper,
    aesGcm.getCiphertextParams(iv),
    ECDSA_PARAMS,
    KEY_IS_EXTRACTABLE,
    PRIVATE_KEY_WILL_BE_USED_TO
  )

  return ecdsaPrivateKey
}

const generateEcdsaKeyData = async (masterKey) => {
  // need to generate new key pair because cannot derive ECDSA key pair using HKDF in WebCrypto
  const ecdsaKeyPair = await generateKeyPair()

  // derive a key wrapper using HKDF to wrap the ECDSA private key and store it on server
  const ecdsaKeyWrapperSalt = hkdf.generateSalt()
  const ecdsaKeyWrapper = await importEcdsaKeyWrapperFromMaster(masterKey, ecdsaKeyWrapperSalt)
  const wrappedEcdsaPrivateKey = await wrapEcdsaPrivateKey(ecdsaKeyPair.privateKey, ecdsaKeyWrapper)

  return {
    ecdsaPrivateKey: ecdsaKeyPair.privateKey,
    ecdsaPublicKey: await getPublicKeyStringFromPublicKey(ecdsaKeyPair.publicKey),
    wrappedEcdsaPrivateKey: base64.encode(wrappedEcdsaPrivateKey),
    ecdsaKeyWrapperSalt: base64.encode(ecdsaKeyWrapperSalt),
  }
}

const sign = async (privateKey, data) => {
  const signature = await window.crypto.subtle.sign(
    ECDSA_SIGNING_PARAMS,
    privateKey,
    data
  )
  return signature
}

const signString = async (privateKey, dataString) => {
  const data = stringToArrayBuffer(dataString)
  const signature = await sign(privateKey, data)
  const signatureString = base64.encode(signature)
  return signatureString
}

const verify = async (publicKey, signature, data) => {
  const isVerified = await window.crypto.subtle.verify(
    ECDSA_SIGNING_PARAMS,
    publicKey,
    signature,
    data
  )
  return isVerified
}

const verifyString = async (publicKey, signatureString, dataString) => {
  const data = stringToArrayBuffer(dataString)
  const signature = base64.decode(signatureString)
  const isVerified = await verify(publicKey, signature, data)
  return isVerified
}

export default {
  generateEcdsaKeyData,
  importEcdsaKeyWrapperFromMaster,
  getPublicKeyFromRawPublicKey,
  getRawPublicKeyFromPublicKey,
  getPublicKeyStringFromPublicKey,
  getPublicKeyFromPrivateKey,
  unwrapEcdsaPrivateKey,
  sign,
  signString,
  verify,
  verifyString,
}
