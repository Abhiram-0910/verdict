async function findFreeVisionModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const data = await res.json();
  const models = data.data;

  const freeVisionModels = models.filter((m: any) => {
    // Check if free
    const isFree = m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0';
    
    // Check if vision-capable
    const arch = m.architecture;
    const isVision = arch && Array.isArray(arch.input_modalities) && arch.input_modalities.includes('image');

    return isFree && isVision;
  });

  console.log(`Found ${freeVisionModels.length} free vision models.`);
  freeVisionModels.forEach((m: any) => {
    console.log(m.id);
  });
}

findFreeVisionModels().catch(console.error);
