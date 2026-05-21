const prisma = require('../utils/prisma');

const MAX_LOGO_BYTES = 200 * 1024;
const SUPABASE_LOGO_BUCKET = process.env.SUPABASE_GYM_LOGO_BUCKET || 'gym-logos';

function normalizePublicImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function getRequiredSupabaseConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase storage is not configured on the server');
  }

  return { supabaseUrl, serviceRoleKey };
}

function getFileExtension(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return null;
}

function sanitizeStoragePathPart(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'gym';
}

const getGymSettings = async (req, res) => {
  const gym = await prisma.gyms.findUnique({
    where: { id: req.gym_id },
    select: {
      id: true,
      gym_id: true,
      gym_name: true,
      owner_name: true,
      email: true,
      phone: true,
      logo_url: true,
    },
  });

  if (!gym) return res.status(404).json({ error: 'Gym not found' });

  res.json({
    gym: {
      id: gym.id,
      gym_code: gym.gym_id,
      gym_name: gym.gym_name,
      owner_name: gym.owner_name,
      email: gym.email,
      phone: gym.phone,
      logo_url: gym.logo_url,
    },
  });
};

const updateGymSettings = async (req, res) => {
  const logoUrl = normalizePublicImageUrl(req.body?.logo_url);

  if (req.body?.logo_url && !logoUrl) {
    return res.status(400).json({ error: 'Valid public image URL is required' });
  }

  const gym = await prisma.gyms.update({
    where: { id: req.gym_id },
    data: { logo_url: logoUrl },
    select: {
      id: true,
      gym_id: true,
      gym_name: true,
      owner_name: true,
      email: true,
      phone: true,
      logo_url: true,
    },
  });

  res.json({
    gym: {
      id: gym.id,
      gym_code: gym.gym_id,
      gym_name: gym.gym_name,
      owner_name: gym.owner_name,
      email: gym.email,
      phone: gym.phone,
      logo_url: gym.logo_url,
    },
    message: 'Settings updated',
  });
};

const uploadGymLogo = async (req, res) => {
  const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const extension = getFileExtension(contentType);
  const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;

  if (!extension) {
    return res.status(400).json({ error: 'Only JPG, PNG, and WebP images are allowed' });
  }

  if (!fileBuffer?.length) {
    return res.status(400).json({ error: 'Image file is required' });
  }

  if (fileBuffer.length > MAX_LOGO_BYTES) {
    return res.status(400).json({ error: 'Image must be less than 200KB' });
  }

  const gym = await prisma.gyms.findUnique({
    where: { id: req.gym_id },
    select: { id: true, gym_id: true },
  });

  if (!gym) return res.status(404).json({ error: 'Gym not found' });

  const { supabaseUrl, serviceRoleKey } = getRequiredSupabaseConfig();
  const gymPath = sanitizeStoragePathPart(gym.gym_id || gym.id);
  const objectPath = `${gymPath}/whatsapp-brand.${extension}`;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${SUPABASE_LOGO_BUCKET}/${objectPath}`;

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: fileBuffer,
  });

  if (!uploadResponse.ok) {
    const details = await uploadResponse.text().catch(() => '');
    throw new Error(details || 'Failed to upload image to Supabase');
  }

  const logoUrl = `${supabaseUrl}/storage/v1/object/public/${SUPABASE_LOGO_BUCKET}/${objectPath}?v=${Date.now()}`;
  const updatedGym = await prisma.gyms.update({
    where: { id: req.gym_id },
    data: { logo_url: logoUrl },
    select: {
      id: true,
      gym_id: true,
      gym_name: true,
      owner_name: true,
      email: true,
      phone: true,
      logo_url: true,
    },
  });

  res.json({
    gym: {
      id: updatedGym.id,
      gym_code: updatedGym.gym_id,
      gym_name: updatedGym.gym_name,
      owner_name: updatedGym.owner_name,
      email: updatedGym.email,
      phone: updatedGym.phone,
      logo_url: updatedGym.logo_url,
    },
    message: 'Logo uploaded',
  });
};

module.exports = {
  getGymSettings,
  updateGymSettings,
  uploadGymLogo,
};
